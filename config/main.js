const { config: dotenv } = require('dotenv');

dotenv();

if (process.env.NODE_ENV === 'development') {
  module.exports = require('./main.dev');
  return;
}

module.exports = {

  // Bot Username
  username: '',
  // Bot Password
  password: '',
  // Bot Identity Secret
  identity: '',
  // Bot Shared Secret
  sharedse: '',

  // Desired admins id 64, one value per quote, splited by comma, example [ "value1", "value2" ]
  admin: ['STEAM_ID64', 'STEAM_ID64'],

  // Steam.supply support to setup your bot in cardbot catalog list!
  SteamSupply: {
    Api: '',
    EnableDB: true,
    Enabled: false,
  },

  // Desired comment you want the bot to make in customers profile, change to "null" witout quotes to disable this feature
  ThanksM: '+Rep!, Please visit https://github.com/JustAzul/BluebotFree <-|-> https://justazul.com!',
  // If you want to change bot name on startups, set the value name here, change to "null" witout quotes to disable this feature
  changeBotName: 'justazul.com Free LevelUP #Bot {rate}',

  // Max sets amount of any appid bot will accept in your inventory, if bot rearch this limit, wont buy more sets of this appid
  maxStock: 100,
  // Max keys bot will accept in trade using !buy or !sell, this value is for tf and tf2 keys
  maxTradeKeys: 15,

  // Max level bot will try to calculate using !level
  maxLevelComm: 999,
  // Max days an customer can be on friend list without be deleted
  maxDays: 4,

  // Enable or disable !sell features here
  enableSell: true,
  // Enable or disable warning messages in admins steam chata ("hey i just have sold x sets for x keys")
  sellmsgs: true,

  // enable, or disable debug logs on console
  DebugLogs: false,

};
