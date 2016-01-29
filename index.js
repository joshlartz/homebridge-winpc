var Service;
var Characteristic;
var request = require("request");
var pollingtoevent = require('polling-to-event');
var wol = require('wake_on_lan');

module.exports = function(homebridge)
{
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory("homebridge-winpc", "WinPC", HttpStatusAccessory);
}

function HttpStatusAccessory(log, config) 
{
	this.log = log;
	var that = this;

	// url info
	this.on_url = config["on_url"];
	this.on_body = config["on_body"];
	this.off_url = config["off_url"];
	this.off_body = config["off_body"];
	this.status_url = config["status_url"];
	this.http_method = config["http_method"] || "GET";;
	this.username  = config["username"] || "";
	this.password = config["password"] || "";
	this.sendimmediately = config["sendimmediately"]  || "";
	this.name = config["name"];
	this.poll_status_interval = config["poll_status_interval"];
	this.interval = parseInt( this.poll_status_interval);
	this.powerstateOnError = config["powerstateOnError"];
	this.powerstateOnConnect = config["powerstateOnConnect"];
	this.info = {
		serialnumber : "Unknown",
		model: "Windows PC",
		manufacterer : "Microsoft",
		name : "Windows PC",
		softwareversion : "Unknown"
	};
	
	this.switchHandling = "check";
	if (this.status_url && this.interval > 10 && this.interval < 100000) {
		this.switchHandling = "poll";
	}	
	this.state = false;

	// Status Polling
	if (this.switchHandling == "poll") {
		var powerurl = this.status_url;
		
		var statusemitter = pollingtoevent(function(done) {
			//that.log("Polling switch level..");
			that.httpRequest(powerurl, "", "GET", that.username, that.password, that.sendimmediately, function(error, response, body) {
				var tResp = body;
				var tError = error;
				if (tError) {
					if (that.powerstateOnError) {
					  tResp = that.powerstateOnError;
					  tError = null;
					}
				} else {
					if (that.powerstateOnConnect) {
					  tResp = that.powerstateOnConnect;
					  tError = null;
					}
				}
				if (tError) {
					that.log('HTTP get power function failed: %s', error.message);
					done(error);
				} else {			
					done(null, tResp);
				}
			})
		}, {longpolling:true,interval:that.interval * 1000,longpollEventName:"statuspoll"});

		statusemitter.on("statuspoll", function(data) {
			var binaryState = parseInt(data);
			that.state = binaryState > 0;
			that.log("State data changed message received: ", binaryState); 

			if (that.switchService ) {
				that.switchService .getCharacteristic(Characteristic.On)
				.setValue(that.state);
			}
		});
	}
}

HttpStatusAccessory.prototype = {

httpRequest: function(url, body, method, username, password, sendimmediately, callback) {
	if (url.substring( 0, 3).toUpperCase() == "WOL") {
		//Wake on lan request
		var macAddress = url.replace(/^WOL[:]?[\/]?[\/]?/ig,"");
		this.log("Excuting WakeOnLan request to "+macAddress);
		wol.wake(macAddress, function(error) {
		  if (error) {
			callback( error);
		  } else {
			callback( null, 200, "OK");
		  }
		});
	} else {
		request({
			url: url,
			body: body,
			method: method,
			rejectUnauthorized: false,
			auth: {
				user: username,
				pass: password,
				sendImmediately: sendimmediately
			}
		},
		function(error, response, body) {
			callback(error, response, body)
		});
	}
},

setPowerState: function(powerOn, callback) {
    var url;
    var body;
	var that = this;

    if (!this.on_url || !this.off_url) {
    	    this.log.warn("Ignoring request; No power url defined.");
	    callback(new Error("No power url defined."));
	    return;
    }

    if (powerOn) {
		url = this.on_url;
		body = this.on_body;
		this.log("Setting power state to on");
    } else {
		url = this.off_url;
		body = this.off_body;
		this.log("Setting power state to off");
    }

    this.httpRequest(url, body, this.http_method, this.username, this.password, this.sendimmediately, function(error, response, responseBody) {
		if (error) {
			that.log('HTTP set power function failed: %s', error.message);
			var powerOn = false;
			that.log("Power state is currently %s", powerOn);
			that.state = powerOn;
			
			callback(null, powerOn);
		} else {
			that.log('HTTP set power function succeeded!');
			callback();
		}
    }.bind(this));
},
  
getPowerState: function(callback) {
    if (!this.status_url) {
    	    this.log.warn("Ignoring request; No status url defined.");
	    callback(new Error("No status url defined."));
	    return;
    }
    
    var url = this.status_url;
    this.log("Getting power state");

    this.httpRequest(url, "", "GET", this.username, this.password, this.sendimmediately, function(error, response, responseBody) {
	  var tResp = responseBody;
	  var tError = error;
	  if (tError) {
		  if (this.powerstateOnError) {
			  tResp = this.powerstateOnError;
			  tError = null;
		  }
	  } else {
		  if (this.powerstateOnConnect) {
			  tResp = this.powerstateOnConnect;
			  tError = null;
		  }
	  }
      if (tError) {
        this.log('HTTP get power function failed: %s', error.message);
		var powerOn = false;
		that.log("Power state is currently %s", powerOn);
		that.state = powerOn;
        callback(null, powerOn);
      } else {
        var binaryState = parseInt(tResp);
        var powerOn = binaryState > 0;
        this.log("Power state is currently %s", binaryState);
		that.state = powerOn;
        callback(null, powerOn);
      }
    }.bind(this));
},

identify: function(callback) {
    this.log("Identify requested!");
    callback(); // success
},

processInformation: function( info, firstTime)
{
	if (!info)
		return;
		
	var equal = true;
	
	var deviceManufacturer = info.manufacturer || "Microsoft";
	if (deviceManufacturer != this.info.manufacturer) {
		equal = false;
		this.info.manufacturer = deviceManufacturer;
	}
	
	var deviceModel = info.model || "Not provided";
	if (deviceModel == "Not provided" && info.model_encrypted) {
		deviceModel = "encrypted";
	}
	if (deviceModel != this.info.model) {
		equal = false;
		this.info.model = deviceModel;
	}
	
	var deviceSerialnumber = info.serialnumber || "Not provided";
	if (deviceSerialnumber == "Not provided" && info.serialnumber_encrypted) {
		deviceSerialnumber = "encrypted";
	}
	if (deviceSerialnumber != this.info.serialnumber) {
		equal = false;
		this.info.serialnumber = deviceSerialnumber;
	}
	
	var deviceName = info.name || "Not provided";
	if (deviceName != this.info.name) {
		equal = false;
		this.info.name = deviceName;
	}
	
	var deviceSoftwareversion = info.softwareversion || "Not provided";
	if (deviceSoftwareversion == "Not provided" && info.softwareversion_encrypted) {
		deviceSoftwareversion = "encrypted";
	}	
	if (deviceSoftwareversion != this.info.softwareversion) {
		equal = false;
		this.info.softwareversion = deviceSoftwareversion;
	}
	
	if( !equal || firstTime) {
		if (this.informationService) {
			this.log('Setting info: '+ JSON.stringify( this.info));
			this.informationService
			.setCharacteristic(Characteristic.Manufacturer, deviceManufacturer)
			.setCharacteristic(Characteristic.Model, deviceModel)
			.setCharacteristic(Characteristic.SerialNumber, deviceSerialnumber)
			.setCharacteristic(Characteristic.Name, deviceName)
			.setCharacteristic(Characteristic.SoftwareRevision, deviceSoftwareversion );
		}
	}
},

getServices: function() {

    // you can OPTIONALLY create an information service if you wish to override
    // the default values for things like serial number, model, etc.
   
	var that = this;

	this.informationService = new Service.AccessoryInformation();
    this.processInformation( this.info, true);

	this.switchService = new Service.Switch(this.name);

	switch (this.switchHandling) {			
		case "check":					
			this.switchService
			.getCharacteristic(Characteristic.On)
			.on('get', this.getPowerState.bind(this))
			.on('set', this.setPowerState.bind(this));
			break;
		case "poll":				
			this.switchService
			.getCharacteristic(Characteristic.On)
			.on('get', function(callback) {callback(null, that.state)})
			.on('set', this.setPowerState.bind(this));
			break;
		default	:	
			this.switchService
			.getCharacteristic(Characteristic.On)	
			.on('set', this.setPowerState.bind(this));
			break;
	}
	return [this.informationService, this.switchService];

	}
};