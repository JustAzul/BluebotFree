const request = require('request');
const moment = require('moment');
const {DebugLogs} = require('../config/main.js');
const {Log} = require('azul-tools');

module.exports = {
    "scan": Scan
};

/**
 * @param {Function} callback 
 */
function Scan(callback) {

    request.get('https://bartervg.com/browse/cards/json/', {
        "json": true
    }, (err, res, data) => {

        if (err || res.statusCode != 200) {
            Log.Debug(`Failed to request barter.vg database, trying again in a minute.`, false, DebugLogs);

            return setTimeout(() => {
                Scan(...arguments);
            }, moment.duration(1, 'minute'));

        }

        let newDB = {};
        let appidCount = 0;

        for (let AppId in data) {
            const details = data[AppId];
            newDB[AppId] = details.cards;
            appidCount++;
        }

        callback(newDB, appidCount);
    });
};