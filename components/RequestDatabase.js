const got = require('got');
const {duration} = require('moment');
const {Log} = require('azul-tools');
const {DebugLogs, SteamSupply} = require('../config/main.js');

async function RequestDatabase() {
    try {
        if (SteamSupply.Enabled && SteamSupply.EnableDB) {
            const Database = await RequestSteamSupply();
            return Database;
        }
    } catch (e) {
        Log.Debug(e, false, DebugLogs);
    }

    return RequestBarter();
}

async function RequestSteamSupply(Attempts = 1) {
    Log.Debug(`Requesting Steam.Supply sets database, Attempt #${Attempts}..`, false, DebugLogs);

    const ParseDatabase = async (data) => JSON.parse(data.trim());

    try {
        const {statusCode, body} = await got(`https://steam.supply/API/${SteamSupply.Api}/cardamount`);

        if(statusCode !== 200) throw new Error("Bad statusCode");
        if (body.indexOf("you are not paid.") > -1 || body.indexOf("API key not found") > -1) throw new Error("bad");

        return ParseDatabase(body);
    } catch (err) {        
        if (err.message === "bad") return Promise.reject("Your Steam.Supply API does not exist.");
        Log.Debug(`Failed to request Steam.Supply database, trying again in a minute.`, false, DebugLogs);
        await sleep(duration(1, 'minute'));
        return RequestSteamSupply(Attempts++);
    }
}

async function RequestBarter(Attempts = 1) {
    Log.Debug(`Requesting Barter.vg sets database, Attempt #${Attempts}..`, false, DebugLogs);

    const ParseDatabase = async function(data) {
        let newDB = {};

        for (let AppId in data) {
            const details = data[AppId];
            newDB[AppId] = details.cards;
        }

        return newDB;
    };

    const o = {
        "url": "https://bartervg.com/browse/cards/json/",
        "responseType": "json"
    };

    try {
        const {statusCode, body} = await got(o);
        if(statusCode !== 200) throw new Error("Bad statusCode");        
        return ParseDatabase(body);
    } catch (err) {
        Log.Debug(`Failed to request Barter.vg database, trying again in a minute.`, false, DebugLogs);
        await sleep(duration(1, 'minute'));
        return RequestBarter(Attempts++);
    }
}

module.exports = RequestDatabase;