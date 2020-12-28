const dotenv = require('dotenv');
dotenv.config();

if (process.env.NODE_ENV == "development"){
	module.exports = require('./main.dev.js'); 
	return;
}

module.exports = {	

	"username": ""		//Bot Username
,	"password": ""		//Bot Password
,	"identity": ""		//Bot Identity Secret
,	"sharedse": ""		//Bot Shared Secret

,	"admin": ["STEAM_ID64", "STEAM_ID64"]		//Desired admins id 64, one value per quote, splited by comma, example [ "value1", "value2" ]

	//Steam.supply support to setup your bot in cardbot catalog list!
	,	"SteamSupply": {
		"Api": "",
		"EnableDB": true,
		"Enabled": false
	}

,	"ThanksM": "+Rep!, Please visit https://github.com/JustAzul/BluebotFree <-|-> https://justazul.xyz!"	//Desired comment you want the bot to make in customers profile, change to "null" witout quotes to disable this feature
,	"changeBotName": "justazul.xyz Free LevelUP #Bot {rate}"				//If you want to change bot name on startups, set the value name here, change to "null" witout quotes to disable this feature

,	"maxStock": 100		//Max sets amount of any appid bot will accept in your inventory, if bot rearch this limit, wont buy more sets of this appid
,	"maxTradeKeys": 15	//Max keys bot will accept in trade using !buy or !sell, this value is for tf and tf2 keys

,	"maxLevelComm": 999	//Max level bot will try to calculate using !level
,	"maxDays": 4 		//Max days an customer can be on friend list without be deleted

,	"enableSell": true		//Enable or disable !sell features here
,	"sellmsgs": true		//Enable or disable warning messages in admins steam chata ("hey i just have selled x sets for x keys")

,	"DebugLogs": false		//enable, or disable debug logs on console

};