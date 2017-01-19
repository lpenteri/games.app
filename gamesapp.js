#!/usr/bin/node
var http = require('http'),
    fs = require('fs');
const url = require("url");
const querystring = require("querystring");
var Gettext = require("node-gettext");
var gt = new Gettext();
var english = fs.readFileSync("./locales/en-GB/messages.pot");
var italian = fs.readFileSync("./locales/it-IT/messages.pot");
gt.addTextdomain("en-GB", english);
gt.addTextdomain("it-IT", italian);

var conf = require('./conf');
var eventclient  = require("./eventclient");


/**
 * \class games app
 * \version 0.2.0
 * \date august 2016
 * \author lazaros penteridis <lp@ortelio.co.uk>
 */
function gamesapp()
{
    this.marvin  = new eventclient(conf.marvin_ip, conf.marvin_port);
    this.topic = "games";
    this.subscriber = "games_app";
    this.resources = ["UI"];
    this.resources_topics = ["UIEvents", "UCEvents"];
    this.locale = "en-GB";
    this.username = "";
    this.ui_subscribed = false;
    this.games_folder = "./games";
    this.img_folder = "./img";
    this.gamelist = [];
    this.app_ip = "localhost";
}


/// \brief scan for games the game folder and create a server to serve the games
gamesapp.prototype.scanfolders = function()
{
    var self = this;
    var files = fs.readdirSync(this.games_folder);
    for (var i in files)
    {
        var pathname = this.games_folder + '/' + files[i];
        // is file

        if (fs.statSync(pathname).isFile())
        {
            // extension is eg. swf
            this.gamelist.push(files[i]);
        }
    }

    // start serving only after we've discovered all games
    this.server = http.createServer();
    this.server.listen(conf.app_port);

    // serve files (must be here to capture `self`)
    this.server.on('request', function(request, response)
    {
        var method = request.method;
        var url = request.url.replace(/^\/|\/$/g, '');
        var gamename = decodeURIComponent(url);
        console.log('search for : ' + gamename);
        var exists = false;

        for (var i in self.gamelist)
        {
            if (self.gamelist[i] === gamename)
            {
                exists = true;
                var game = self.gamelist[i];
                // the full pathname
                var filename = self.games_folder + '/' + game;
                var stat = fs.statSync(filename);
                // verify file & serve it
                if (stat.isFile())
                {
                    response.writeHead(200, {'Content-Type' : 'application/octet-stream',
                                             'Content-Length' : stat.size});
                    var stream = fs.createReadStream(filename);
                    stream.pipe(response);
                }
                // throw an tantrum
                else
                {
                    console.log("not a file");
                    response.writeHead(500);
                    response.end();
                }
            }
        }
        if (!exists)
        {
            // assume it wasn't found, send a 404
            console.log("game not found");
            response.writeHead(404, {"Content-Type": "text/plain"});
            response.end('404 Not Found\n');
        }
    });
}


/// \brief get the url of a game in order to be served
/// \param gamename the name of the game
gamesapp.prototype.get_game_url = function(gamename)
{
    // if gamename exists in gamelist
    for (var i = 0; i < this.gamelist.length; i++)
    {
        if ((gamename + ".swf") === this.gamelist[i])
        {
            return this.app_ip + ':' + conf.app_port + '/' + encodeURIComponent(gamename) + '.swf';
        }
    }
}


/**
 * \brief initialization steps the app must follow when the start message from the task manager comes
 *        register for games topic, create as needed
 * \param resources (optional) is an array of stings with the resources that required the app, so the app
 *        needs to subscribe to their topics.
 */
gamesapp.prototype.init = function(resources)
{
    var self = this;

    self.marvin.get_topics(function(json)
    {
        var exists = false;
        var topics = [];
        try
        {
            topics = JSON.parse(json);
        }
        catch (e)
        {
            console.log('init/parse error: ' +e);
            console.log(json);
        }
        for (var i = 0; i < topics.length; i++)
        {
            if (topics[i] === self.topic)
            {
                exists = true;
            }
        }
        if (!exists) {
            self.marvin.new_topic(self.topic, function(ok)
            {
                if (ok)
                {
                    console.log(self.topic + ' created successfully.');
                }
                else
                {
                    console.log('failed to create topic: ' + self.topic + ' aborting...');
                    return;
                }
            });
        }
        else
        {
//          throw self.topic + ' existed already.';
            console.log(self.topic + ' existed already.');
        }
    });
}


/**
 * \brief initialization steps the app must follow when the message from the task manager saying that he is
 *        subscribed to the app's topic comes. The app replies with the components it requires to work properly.
 * \param id Task manager subscribed message id, in order to be used as correlation id to the reply message.
 */
gamesapp.prototype.start = function(id)
{
    var self = this;

    // post message with the resources the app requires for the task manager to consume it and start them
    var json = {};
    json.correlationId = id;
    var body = {};
    body.targets = ["taskmanager"];
    body.resources = self.resources;
    json.body = JSON.stringify(body);
    self.post(json,
    function()
    {
        console.log("successfully posted: " + JSON.stringify(json));
    },
    function(error)
    {
        console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
    });

    // try to subscribe to all topics of the required resources in order to be able to use them
    if (self.resources_topics.length)
    {
        self.marvin.get_topics(function(json)
        {
            for (i = 0; i < self.resources_topics.length; i++)
            {
                self.search_n_sub(self.resources_topics[i], json);
            }
        });
    }

    // post message asking the UI for the required config parameters and wait for a reply to get these
    // parameters and to know that the UI subscribed in the app's topic
    // message format { "action" : "sendconfig",
    //                  "configs" : ["username", "locale"] }
    json = {};
    var body = {};
    body.targets = ["UI"];
    body.action = "sendconfig";
    body.configs = ["username", "locale"];
    json.body = JSON.stringify(body);
    self.post(json,
    function()
    {
        console.log("successfully posted: " + JSON.stringify(json));
    },
    function(error)
    {
        console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
    });
    var interval = setInterval(function()
    {
        if(self.ui_subscribed === true){
            clearInterval(interval);
            return;
        }
        self.post(json,
    function()
    {
        console.log("successfully posted: " + JSON.stringify(json));
    },
    function(error)
    {
        console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
    });
    }, 1000);
}


/**
 * \brief initialization steps the app must follow when the message from the task manager asking it to stop comes.
 *        The app unsubscribes from all topics except taskmanager, posts a message that it stopped and deletes
 *        its topic.
 * \param id Task manager subscribed message id, in order to be used as correlation id to the reply message.
 */
gamesapp.prototype.stop = function(id)
{
    var self = this;

    if (self.resources_topics.length)
    {
        for (i = 0; i < self.resources_topics.length; i++)
        {
            var current_topic;
            self.marvin.unsubscribe(current_topic=self.resources_topics[i], self.subscriber, function(ok)
            {
                if (ok)
                {
                    console.log(self.subscriber + ' successfully unsubscribed from topic ' + current_topic);
                }
                else
                {
                    throw self.subscriber + ' failed to unsubscribe from topic: ' + current_topic;
                }
            });
        }
    }

    var json = {};
    json.correlationId = id;
    var body = {};
//    body.targets = ["taskmanager"];
    body.state = "stopped";
    json.body = JSON.stringify(body);
    self.post(json,
    function()
    {
        console.log("successfully posted: " + JSON.stringify(json));
        // The message that the app stopped was sent successfully, so now we can delete the topic
        self.marvin.del_topic(self.topic, function(ok)
        {
            if (ok)
            {
                console.log(self.topic + ' deleted successfully.');
                self.ui_subscribed = false;
            }
            else
            {
                throw 'failed to delete topic: ' + self.topic + ' aborting...';
            }
        });
    },
    function(error)
    {
        console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
    });
}


/// \brief publish a message to the topic of the app after ensuring its existence
/// \param json the json object to be passed to eventclient.publish in order to be posted
gamesapp.prototype.post = function(json, on_success, on_failure)
{
    var self = this;

    self.marvin.get_topics(function(topics_json)
    {
        var exists = false;
        var topics = [];
        try
        {
            topics = JSON.parse(topics_json);
        }
        catch (e)
        {
            console.log('init/parse error: ' +e);
            console.log(topics_json);
        }
        for (var i = 0; i < topics.length; i++)
        {
            if (topics[i] === self.topic)
            {
                exists = true;
            }
        }
        if (exists) {
            self.marvin.publish(self.topic, json, on_success, on_failure);
        }
        else
        {
            throw self.topic + " no longer exists.";
        }
    });
}


/**
 * \brief process a new message and pass it to the appropriate function depending on who sent it
 */
gamesapp.prototype.msg_proc = function(message, topic)
{
    var self = this;

    // split the message into an array using the newline(s)
    var list = message.split("\n\n").filter(function(el){return el.length !== 0;});
    // get the last message from the marvin queue
    var last = list[list.length - 1];
    // remove the first 6 characters (`data =`)
    message = last.substring(6);
    var data = null;

    // parse message
    try {
        var data = JSON.parse(message);
    }
    catch (e) {
        console.log('parse error: ' + e);
        console.log(message);
    }
    if (topic === "taskmanager")
    {
        self.tm_msg(data);
    }
    else if (topic === "UIEvents" || topic === "UCEvents")
    {
        self.ui_msg(data);
    }
}


/**
 * \brief process and take proper action concerning messages from the taskmanager topic
 * \param data the data property of the message.
 */
gamesapp.prototype.tm_msg = function(data)
{
    var self = this;

    if (data.hasOwnProperty("messageId"))
    {
        var msg_id = data.messageId;
    }

    if (data.hasOwnProperty("body"))
    {
        var body = JSON.parse(data.body);
        if (body.hasOwnProperty("ability") && (body.ability === self.topic)) {
            if (body.hasOwnProperty("command"))
            {
                if ((body.command === "start") && !body.hasOwnProperty("resources"))
                {
                    self.init();
                }
                else if ((body.command === "start") && body.hasOwnProperty("resources"))
                {
                    self.init(body.resources);
                }
                else if (body.command === "stop")
                {
                    self.stop(msg_id);
                }
            }
            else if (body.hasOwnProperty("state"))
            {
                if (body.state === "subscribed")
                {
                    self.start(msg_id);
                }
                else if (body.state !== "running")
                {
                    console.log("Wrong message format. Unknown state.");
                }
            }
            else
            {
                console.log("Wrong message format. No command or state.");
            }
        }
    }
    else
    {
        console.log('Wrong message format. No `body` found.');
    }
}


/**
 * \brief process and take proper action concerning messages from the UIEvents topic
 * \param data the data property of the message.
 */
gamesapp.prototype.ui_msg = function(data)
{
    var self = this;

    if (data.hasOwnProperty("body"))
    {
        var body = JSON.parse(data.body);

        // check JSON format and members
//        if (body.hasOwnProperty("event") && body.hasOwnProperty("ability") && (body.ability === self.topic))
        if (body.hasOwnProperty("ability") && (body.ability === self.topic))
        {
//            if (body.event === "touch" || body.event === "speak")
//            {
                if (body.hasOwnProperty("action"))
                {
                    var act_url = url.parse(body.action);
                    var action = act_url.pathname;
                    var act_params = querystring.parse(act_url.query);
                    if (action === "selectgame")
                    {
                        var json ={};
                        var body = {};
                        body.targets = ["UI"];
                        body.action = "showoptions";
                        body.heading = gt.dgettext(self.locale, "Which game would you like to play?");
                        var options = [];
                        for (var i=0; i<this.gamelist.length; i++)
                        {
                            var temp = {};
                            temp.name = gt.dgettext(self.locale, this.gamelist[i].slice(0, -4)) + "? ";
                            temp.img = "/_img/mario/games/" + this.gamelist[i].slice(0, -4) + ".png";
                            temp.action = "gamehome?game=" + this.gamelist[i].slice(0, -4);
                            temp.keywords = gt.dgettext(self.locale, this.gamelist[i].slice(0, -4)).split(" ");
                            options.push(temp);
                        }

                        body.options = options;
                        json.body = JSON.stringify(body);

                        self.post(json,
                            function()
                            {
                                console.log("successfully posted: " + JSON.stringify(json));
                            },
                            function(error)
                            {
                                console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
                            });
                    }
                    else if (action === "gamehome")
                    {
                        var json ={};
                        var body = {};
                        body.targets = ["UI"];
                        body.action = "showoptions";
                        body.heading = gt.dgettext(self.locale, "What would you like to do?");
                        var options = [];

                        var temp = {};
                        temp.name = gt.dgettext(self.locale, "Play? ");
                        temp.img = "/_img/mario/play.png";
                        temp.action = "playgame?game=" + act_params.game;
                        temp.keywords = gt.dgettext(self.locale, "play_keywords").split(', ');
                        options.push(temp);

                        temp = {};
                        temp.name = gt.dgettext(self.locale, "Instructions? ");
                        temp.img = "/_img/mario/manual.png";
                        temp.action = "instructions?game=" + act_params.game;
                        temp.keywords = gt.dgettext(self.locale, "instructions_keywords").split(', ');
                        options.push(temp);

                        body.options = options;
                        json.body = JSON.stringify(body);

                        self.post(json,
                            function()
                            {
                                console.log("successfully posted: " + JSON.stringify(json));
                            },
                            function(error)
                            {
                                console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
                            });
                    }
                    else if (action === "instructions")
                    {
                        var instructions_id = act_params.game + " instructions";
                        var json ={};
                        var body = {};
                        body.targets = ["UI"];
                        body.action = "showarticle";
                        body.title = gt.dgettext(self.locale, act_params.game);
                        body.text = gt.dgettext(self.locale, instructions_id);
                        body.img = "/_img/mario/games/" + act_params.game + ".png";
                        body.nextaction = "playgame?game=" + act_params.game;

                        json.body = JSON.stringify(body);

                        self.post(json,
                            function()
                            {
                                console.log("successfully posted: " + JSON.stringify(json));
                            },
                            function(error)
                            {
                                console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
                            });
                    }
                    else if (action === "playgame")
                    {
                        var game_url = "http://" + self.get_game_url(act_params.game);

                        var json ={};
                        var body = {};
                        body.targets = ["UI"];
                        body.action = "showexternal";
                        body.name = gt.dgettext(self.locale, act_params.game);
                        body.url = game_url;
                        body.arrowkeys = "false";
                        json.body = JSON.stringify(body);

                        self.post(json,
                            function()
                            {
                                console.log("successfully posted: " + JSON.stringify(json));
                            },
                            function(error)
                            {
                                console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
                            });
                    }
                }
/*                }
                else
                {
                    console.log("Wrong message format. Action property missing.");
                }
            } */
//            else if (body.event === "config")
            if (body.event === "config")
            {
                self.ui_subscribed = true;
                if (body.hasOwnProperty("locale"))
                {
                    self.locale = body.locale;
                }
                if (body.hasOwnProperty("username"))
                {
                    self.locale = body.locale;
                }
                var json ={};
                var body = {};
                body.targets = ["UI"];
                body.action = "showoptions";
                body.heading = gt.dgettext(self.locale, "Which game would you like to play?");
                var options = [];
                for (var i=0; i<this.gamelist.length; i++)
                {
                    var temp = {};
                    temp.name = this.gamelist[i].slice(0, -4);
                    temp.img = "/_img/mario/games/" + this.gamelist[i].slice(0, -4) + ".png";
                    temp.action = "gamehome?game=" + this.gamelist[i].slice(0, -4);
                    temp.keywords = gt.dgettext(self.locale, this.gamelist[i].slice(0, -4)).split(" ");
                    options.push(temp);
                }
                body.options = options;
                json.body = JSON.stringify(body);

//              var json_str = JSON.stringify(json).replace(/(\\+)/g, "\\");
//              var json_str = str.replace(/(\\+)/g, "\\");
//              self.post(json_str);
                self.post(json,
                    function()
                    {
                        console.log("successfully posted: " + JSON.stringify(json));
                    },
                    function(error)
                    {
                        console.log("post failed: " + JSON.stringify(json) + "\nerror code: " + error);
                    });
            }
/*            else if (body.event !== "subscribed")
            {
                console.log("Wrong message format. Unknown event.");
            } */
        }
    }
    else
    {
        console.log('Wrong message format. No `body` found.');
    }
}


/**
 * \brief unsubscribe self from topic
 * \note may happen on termination or crash or exception
 *       where a subscriber using the `games_app` name exists.
 */
gamesapp.prototype.unsub_resub = function(topic)
{
    var self = this;

    self.marvin.get_subscribers(topic, function(json) {
        var exists = false;
        var subs = [];
        try
        {
            subs = JSON.parse(json);
        }
        catch (e) {
            console.log('unsub_resub/parse error: ' + e);
            console.log(json);
        }
        for (var i = 0; i < subs.length; i++) {
            if (subs[i] === self.subscriber)
            {
                exists = true;
            }
        }
        if (exists) {
            console.log('subscriber ' + self.subscriber + ' to topic ' + topic + ' exists, removing...');
            self.marvin.unsubscribe(topic, self.subscriber, function(){
                console.log('subscriber ' + self.subscriber + ' to topic ' + topic + ' removed, re-subscribing');
                self.marvin.subscribe(topic, self.subscriber, function(message){
                    self.msg_proc(message, topic);
                });
            });
        }
        else
        {
            console.log('subscriber ' + self.subscriber + ' to topic ' + topic + ' does not exist, subscribing');
            self.marvin.subscribe(topic, self.subscriber, function(message){
                self.msg_proc(message, topic);
            });
        }
    });
}

/**
 * \brief search for a topic until it's created and then subscribe to it.
 * \param topic the topic to be searched.
 * \param json array with the topics, in which we are searching.
 */
gamesapp.prototype.search_n_sub = function(topic, json)
{
    var self = this;
    var topics = [];
    var exists = false;
    try {
        topics = JSON.parse(json);
    }
    catch (e) {
        console.log('init/parse error: ' +e);
        console.log(json);
    }
    for (var i = 0; i < topics.length; i++)
    {
        if (topics[i] === topic)
        {
            exists = true;
        }
    }
    // topic exists - (re)subscribe and process messages
    if (exists) {
        console.log('topic: ' + topic + ' exists, will try to subscribe');
        self.unsub_resub(topic);
    }
    // get the topics again until topic is found
    else {
        console.log('topic ' + topic + ' not found. Will try again in 0.5 seconds...');
        setTimeout(function() {
            self.marvin.get_topics(function(json) {
                self.search_n_sub(topic, json);
            });
        }, 500);
    }
}

/**
 * \brief subscribe to taskmanager topic
 */
gamesapp.prototype.run = function()
{
    var self = this;
    self.marvin.get_topics(function(json) {
        self.search_n_sub("taskmanager", json);
    });
    self.scanfolders();
}

/// exports
module.exports = gamesapp;
