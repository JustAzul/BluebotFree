const fs = require('graceful-fs');
const moment = require('moment');
const SteamTotp = require('steam-totp');
const BadgeScanner = require('../components/BadgeScanner.js');
const {EOL} = require('os');
const {Log, storeFile, readJSON} = require('azul-tools');
const {DebugLogs, sharedse, username, password} = require('../config/main.js')
const StdLib = require('@doctormckay/stdlib');

let CardDatabase = {};

const Offers = new StdLib.DataStructures.LeastUsedCache(Infinity, moment.duration(10, 'minutes'));

let Profits = {
	"tf2": {
		"buy": {
			"sets": 0,
			"currency": 0
		},
		"sell": {
			"sets": 0,
			"currency": 0
		}
	}
};

module.exports = {
	Init: Init,

	GenerateSteamGuardToken: GenerateSteamGuardToken,
	getLogOn: getLogOn,

	isSteamCommonError: isSteamCommonError,
	ExpForLevel: ExpForLevel,
	fixNumber: fixNumber,

	getSetsCount: getSetsCount,
	getProfits: getProfits,

	isTradeOfferRepeated: isTradeOfferRepeated,
	newTradeOfferFinished: newTradeOfferFinished,

	UpdateProfits: UpdateProfit,

	breakline: EOL,
	Now: Now
}

async function Init(){
	try {
		Profits = JSON.parse(fs.readFileSync(`${process.cwd()}/data/profits.json`)) || Profits;
	} catch (e) {}
	await LoadLocalCardDatabase();

	setInterval(() => {
		Log.Debug("Updating card sets Database..", false, DebugLogs);
		UpdateDatabase();
	}, moment.duration(25, 'hours'));
}

function UpdateDatabase() {
	return new Promise(resolve => {
		BadgeScanner.scan((database, totalApps) => {
			storeData("database.json", database, true).then(() => {
				Log.Debug(`Database up to date!, Found ${totalApps} apps with cards!`, false, DebugLogs);
				resolve();
			})
		});
	});
}

async function getSetsCount(appid){
	if (CardDatabase.hasOwnProperty(appid)) return CardDatabase[appid];
	return 0;
}

function getProfits(){
	return Profits;
}

function isTradeOfferRepeated(OfferID){
	return Offers.get(OfferID);
}

function newTradeOfferFinished(OfferID){
	Offers.add(OfferID, true);
}

async function LoadLocalCardDatabase(){
	CardDatabase = await readJSON("data/database.json");
	if(Object.keys(CardDatabase).length == 0) return UpdateDatabase();
	Log.Debug(`Successfuly loaded ${Object.keys(CardDatabase).length} apps!`, false, DebugLogs);
}

async function UpdateProfit(SellInfoType, SellInfoCurrency, _sets, _currency) {
	switch (SellInfoType) {
		case 0:
			//sold
			if (SellInfoCurrency == "tf key(s)") UpdateProfits(0, 0, _sets, _currency);
			break;
		case 1:
			//bought
			if (SellInfoCurrency == "tf key(s)") UpdateProfits(_sets, _currency);
			break;
	}
}

async function UpdateProfits(BuySets = 0, BuyCurrency = 0, SellSets = 0, SellCurrency = 0) {
	Profits.tf2.buy.sets += BuySets;
	Profits.tf2.buy.currency += BuyCurrency;

	Profits.tf2.sell.sets += SellSets;
	Profits.tf2.sell.currency += SellCurrency;
	
	return storeData(`profits.json`, this.Profits, true);
}

function Now() {
	return new Date().getTime();
}

function storeData(filename, data, json = false){
	return storeFile(`data/${filename}`, json ? JSON.stringify(data) : data, 'w');
}

function getLogOn() {
	return {
		"accountName": username,
		"password": password,
		"rememberPassword": true
	};
}

async function GenerateSteamGuardToken() {
    return SteamTotp.getAuthCode(sharedse);
}

async function ExpForLevel(level = 0) {
    let exp = 0;

    for (let i = 1; i <= level; i++) {
        exp += Math.ceil(i / 10) * 100; //Current level exp
    }

    return exp;
}

function fixNumber(number, x) {
	return parseFloat(number.toFixed(x));
}

function isSteamCommonError(ErrorMessage = "", LowerCase = false) {
	if (LowerCase) ErrorMessage = ErrorMessage.toLowerCase();
	if (ErrorMessage.indexOf("socket hang up") > -1) return true;
	if (ErrorMessage.indexOf("EBUSY") > -1) return true;
	if (ErrorMessage == "ETIMEDOUT") return true;
	if (ErrorMessage == "ESOCKETTIMEDOUT") return true;
	return false;
}