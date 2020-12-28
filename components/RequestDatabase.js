const request = require('request');
const moment = require('moment');
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

function RequestSteamSupply(Attempts = 1) {
    Log.Debug(`Requesting steam.supply sets database, Attempt #${Attempts}..`, false, DebugLogs);
    return new Promise((resolve, reject) => {
        request.get(`https://steam.supply/API/${SteamSupply.Api}/cardamount`, {
            "json": true
        }, (err, res, data) => {
            if (err || res.statusCode != 200) {
                Log.Debug(`Failed to request steam.supply database, trying again in a minute.`, false, DebugLogs);
                setTimeout(() => {
                    resolve(RequestSteamSupply(Attempts + 1));
                }, moment.duration(1, 'minute'));
                return;
            }

            if (data.indexOf("you are not paid.") > -1 || data.indexOf("API key not found") > -1) {
                reject("Your steam.supply api its not correct, or you its not featured.");
                return;
            }

            parseSteamSupplyDatabase(data).then(resolve)
                .catch(err => {
                    Log.Debug(`Failed to parse steam.supply database, trying again in a minute.`, false, DebugLogs);
                    setTimeout(() => {
                        resolve(RequestSteamSupply(Attempts + 1));
                    }, moment.duration(1, 'minute'));
                    return;
                });
        })
    })
}

function RequestBarter(Attempts = 1) {
    Log.Debug(`Requesting sets database, Attempt #${Attempts}..`, false, DebugLogs);
    return new Promise((resolve, reject) => {
        request.get('https://bartervg.com/browse/cards/json/', {
            "json": true
        }, (err, res, data) => {

            //if (Attempts >= 5) return reject(`Failed to many times to request barter database!`);
            if (err || res.statusCode != 200) {

                Log.Debug(`Failed to request barter.vg database, trying again in a minute.`, false, DebugLogs);

                return setTimeout(() => {
                    resolve(RequestBarter(Attempts + 1));
                }, moment.duration(1, 'minute'));

            }

           return parseBarterDatabase(data).then(resolve);

        })
    })
}

async function parseBarterDatabase(db) {
    let newDB = {};

    for (let AppId in db) {
        const details = db[AppId];
        newDB[AppId] = details.cards;
    }

    return newDB;
}

async function parseSteamSupplyDatabase(data) {
    const db = JSON.parse(data.trim());
    return db;
}

module.exports = RequestDatabase;