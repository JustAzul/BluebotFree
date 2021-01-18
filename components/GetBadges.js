const got = require('got');
const {isSteamCommonError} = require('./helpers.js');
const {Log, sleep} = require('azul-tools');
const {DebugLogs} = require('../config/main.js');

async function GetBadges(SteamID, apiKey) {
	const qs = {
		steamid: SteamID,
		key: apiKey
	};

	const o = {
		"prefixUrl": "https://api.steampowered.com/",
		"url": "IPlayerService/GetBadges/v1/",
		"searchParams": qs,
		"responseType": "json"
	};

	try {

		const {body} = await got(o);

		const Result = body['response'];
		return Result;

	} catch (err) {

		if (isSteamCommonError(err.messsage)) {
			Log.Debug(`Failed to request #${SteamID} badges, its a steam commom error, so trying again..`, false, DebugLogs);
			await sleep(duration(5, 'second'));
			return GetBadges(...arguments);
		}

		Log.Error(`Failed to request #${SteamID} badges => ${err}`, false, DebugLogs);
		return Promise.reject(err);
	}

}

module.exports = GetBadges;