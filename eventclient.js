#!/usr/bin/node
var http = require('http');

/// \brief class eventclient communicates with marvin/SSE
/// \version 0.1.1
/// \date may 2016
/// \author alex giokas <a.gkiokas@ortelio.co.uk>
///
function eventclient(ip, port) {
	this.ip = ip;
	this.port = port;
    this.uri = '/marvin/eventbus/topics/';
    this.subpar = '?subscribername=';
}

/// \brief create new topic
/// \param name the name of the topic
/// \param functor is the callback receiving the response
eventclient.prototype.new_topic = function(topic, functor)
{
	var options = {
		host: this.ip,
		port: this.port,
		path: this.uri + topic,
		method: 'PUT'
	};
	callback = function(response) {
		var buffer = '';
		response.on('data', function (chunk) {
			buffer += chunk;
		});
		response.on('end', function () {
			// 201 = ok
            if (response.statusCode == 201) {
                functor(true);
            }
			// 409 = conflict ||  404 = wrong uri
            else {
                functor(false);
            }
		});
	}
	var req = http.request(options, callback);
	req.on('error', function(err) {
		console.log('new_topic error: ' +  error);
	});
	req.end();
}

/// \brief get available topics
/// \param functor is the callback receiving the topics
eventclient.prototype.get_topics = function(functor)
{
	var options = {
		host: this.ip,
		port: this.port,
		path: this.uri,
		method: 'GET',
	};
	callback = function(response) {
		var buffer = '';
		response.on('data', function (chunk) {
			buffer += chunk;
		});
		response.on('end', function () {
            functor(buffer);
		});
	}
	var req = http.request(options, callback);
	req.on('error', function(err) {
		console.log('get_topics error: ' + err);
	});
	req.end();
}

/// \brief delete topic
/// \param topic is the topic's name
/// \param functor is the callback receiving the response
eventclient.prototype.del_topic = function(topic, functor)
{
	var options = {
		host: this.ip,
		port: this.port,
		path: this.uri + topic,
		method: 'DELETE',
	};
	callback = function(response) {
        if (response.statusCode === 204) {
        	functor(true);
        }
        else {
        	functor(false);
        }
	}
	var req = http.request(options, callback);
	req.on('error', function(err) {
		console.log('del_topic error: ' + err);
	});
	req.end();
}

/// \brief subscribe to a topic
/// \param topic is the subscription
/// \param name is the subscribers name
/// \param functor is the callback receiving the response
/// \param handler is called when the subscription closes (error or dropped)
eventclient.prototype.subscribe = function(topic, name, functor)
{
	var options = {
		host: this.ip,
		port: this.port,
		path: this.uri + topic + this.subpar + name,
		method: 'GET',
		keepAlive: true
	};
	callback = function(response) {
		var buffer = '';
		response.on('data', function(chunk) {
			var data = chunk.toString('utf8');
			if (data.indexOf("\r\n\r\n")) {
				buffer += data
                functor(buffer);
			}
			else {
				buffer += chunk;
			}
		});
		response.on('end', function(){
			console.log("subscribe: to " + topic + " connection closed");
		});
	}
	var req = http.request(options, callback);
	req.on('error', function(err) {
		console.log('subscribe error: ' + err);
	});
	req.end();
}

/// \brief get subscribers of a topic
/// \param topic
/// \param functor is the callback receiving the response
eventclient.prototype.get_subscribers = function(topic, functor)
{
	var options = {
		host: this.ip,
		port: this.port,
		path: this.uri + topic + '/subscribers',
		method: 'GET',
	};
	callback = function(response) {
		var buffer = '';
		response.on('data', function (chunk) {
			buffer += chunk;
		});
		response.on('end', function () {
            functor(buffer);
		});
	}
	var req = http.request(options, callback);
	req.on('error', function(err) {
		console.log('get_subscribers error: ' + err);
	});
	req.end();
}

/// \brief unsubscribe from a topic
/// \brief topic the name on which you were subed
/// \brief name the subscriber's name
eventclient.prototype.unsubscribe = function(topic, name, functor)
{
	var options = {
		host: this.ip,
		port: this.port,
		path: this.uri  + topic + this.subpar + name,
		method: 'DELETE'
	};
	callback = function(response) {
        if (response.statusCode === 204) {
           functor(true);
        }
        else {
            functor(false);
        }
	}
	var req = http.request(options, callback);
	req.on('error', function(err) {
		console.log('ubsubscribe error: ' + err);
	});
	req.end();
}

/// \brief publish a message
/// \param topic to which we will post
/// \param text which will be posted
eventclient.prototype.publish = function(topic, json, on_success, on_failure)
{
	var data   = JSON.stringify(json);
	var options = {
		host: this.ip,
		port: this.port,
		path: this.uri + topic,
		method: 'POST',
		body: data,
        headers: {'Content-Type' : 'application/json'}
	};
	callback = function(response) {
		var buffer = '';
		response.on('data', function(chunk) {
			buffer += chunk;
		});
		response.on('end', function(){
            if (response.statusCode = 200) { 
                on_success();
            }
            else {
            	on_failure(response.statusCode);
            }
		});
	}
	var req = http.request(options, callback);
	req.on('error', function(err) {
		console.log('publish error: ' + err);
	});
    req.write(data);
	req.end();
}

/// exports
module.exports = eventclient;
