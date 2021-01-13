const SteamUser = require('steam-user');
const config = require('../config/main.js');
const fs = require('graceful-fs');
const moment = require('moment');
const {Log, storeChatData, sleep} = require('azul-tools');
const helper = require('./helpers.js');

let client;
let Warns = {};
let User = {
	LastInteraction: {},
	LastComment: {}
};

module.exports = {
	Init: Init,

	Message: Message,
	sendAdminMessages: sendAdminMessages,

	canComment: canComment,
	UserInteract: RegisterUserInteract,

	WarnUser: WarnUser,
	getUserWarns: getUserWarns,

	checkSpam: checkSpam
}

function setup(_client){
	client = _client;
}

async function Init() {
	setup(...arguments);

	try {
		User.LastInteraction = JSON.parse(fs.readFileSync(`${process.cwd()}/data/LastUserInteracts.json`)) || User.LastInteraction;
	} catch (e) {}

	try {
		User.LastComment = JSON.parse(fs.readFileSync(`${process.cwd()}/data/LastUserComments.json`)) || User.LastComment;
	} catch (e) {}

	setInterval(() => {
		checkUsers();
	}, moment.duration(1, 'hour')); //1 hour
}

async function checkUsers() {
	for (let UserID64 in client.myFriends) {

		if (client.myFriends[UserID64] != SteamUser.EFriendRelationship.Friend) continue; //user is not a friend type
		if (config.admin.indexOf(UserID64) > -1) continue; //user is an admin

		if (!User.LastInteraction[UserID64]) { //somehow user doesn't not have an interact data
			User.LastInteraction[UserID64] = helper.Now();
			continue;
		}

		if (moment().diff(User.LastInteraction[UserID64], 'days', true) >= config.maxDays) { //goodbye
			let response = helper.breakline + "Hey, it's been a while since you're have inactive, I'll unfriend you, but if you need anything, just add me again :)";
			response += helper.breakline + "Hope i'll see you again, bye!";
			Message(UserID64, response);
			Log.Debug("User #" + UserID64 + " has have been inactive for a long time and has been removed from bot friendlist!", false, config.DebugLogs);
			setTimeout(() => {
				client.removeFriend(UserID64);
			}, 2500);
		}

	}
}

async function checkSpam(source, date) {
	if (!User.LastInteraction.hasOwnProperty(source)) return false;
	const LastUserInteractDate = User.LastInteraction[source];
	if (moment(date).diff(LastUserInteractDate, 'seconds', true) <= 1) return true;
}

function getUserWarns(steamid){
	return Warns[steamid] || 0;
}

function WarnUser(steamid){
	if(!Warns.hasOwnProperty(steamid)) Warns[steamid] = 0;
	Warns[steamid]++;
}

 async function Message(steamid, msg) {
 	msg = msg.length > 25 ? (helper.breakline + msg) : msg;
 	try {
 		const response = await client.chat.sendFriendMessage(steamid, msg.replace(/({breakline})/g, helper.breakline));
 		const server_timestamp = response.server_timestamp;
 		storeChatData(steamid, msg, true, server_timestamp);
 		return response;
 	} catch (e) {}
 }

function RegisterUserInteract(userID64, UpdateCommentDate = false) {
	if (UpdateCommentDate) {
		User.LastComment[userID64] = helper.Now();
		return;
	}
	User.LastInteraction[userID64] = helper.Now();
}

async function canComment(UserID64) {
	const canComment = moment().diff(User.LastComment[UserID64], 'hours', true) >= 12;
	return canComment;
}

async function sendAdminMessages(message) {
	Log.Debug(`Sending a chat message for all admins..`, false, config.DebugMode);

	for (let i in config.admin) {
		const Admin = config.admin[i];
		await Message(Admin, message);
		await sleep(moment.duration(2, 'second'));
	}

	return;
}