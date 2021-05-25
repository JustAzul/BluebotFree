const { EFriendRelationship } = require('steam-user');
const { readFileSync } = require('graceful-fs');
const moment = require('moment');
const { Log, storeChatData, sleep } = require('azul-tools');
const { EOL: breakline } = require('os');
const config = require('../config/main');
const { Now, isAdmin } = require('./helpers');

let client;

const Warns = {};
const User = {
  LastInteraction: {},
  LastComment: {},
};

function setup(_client) {
  client = _client;
}

async function sendChatMessage(steamid, msg) {
  msg = msg.length > 25 ? (breakline + msg) : msg;
  try {
    const response = await client.chat.sendFriendMessage(steamid, msg.replace(/({breakline})/g, breakline));
    const { server_timestamp: ServerTimeStamp } = response;
    storeChatData(steamid, msg, true, ServerTimeStamp);
    return response;
  } catch {}
}

async function checkUsers() {
  let keys = Object.keys(client.myFriends || {});
  for (let i = 0; i < keys.length; i++) {
    const UserID64 = keys[i];
    if (client.myFriends[UserID64] !== EFriendRelationship.Friend) continue; // user is not a friend type
    if (isAdmin(UserID64)) continue; // user is an admin

    if (!User.LastInteraction[UserID64]) { // somehow user doesn't not have an interact data
      User.LastInteraction[UserID64] = Now();
      continue;
    }

    if (moment().diff(User.LastInteraction[UserID64], 'days', true) >= config.maxDays) { // goodbye
      let response = `${breakline}Hey, it's been a while since you're have inactive, I'll unfriend you, but if you need anything, just add me again :)`;
      response += `${breakline}Hope i'll see you again, bye!`;
      sendChatMessage(UserID64, response);
      Log.Debug(`User #${UserID64} has have been inactive for a long time and has been removed from bot friendlist!`, false, config.DebugLogs);
      setTimeout(() => client.removeFriend(UserID64), 2500);
    }
  }
  keys = null;
}

async function Init() {
  setup(...arguments);

  try {
    User.LastInteraction = JSON.parse(readFileSync(`${process.cwd()}/data/LastUserInteracts.json`)) || User.LastInteraction;
  } catch {}

  try {
    User.LastComment = JSON.parse(readFileSync(`${process.cwd()}/data/LastUserComments.json`)) || User.LastComment;
  } catch {}

  setInterval(() => {
    checkUsers();
  }, moment.duration(1, 'hour')); // 1 hour
}

async function checkSpam(source, date) {
  if (!Object.prototype.hasOwnProperty.call(User.LastInteraction, source)) return false;
  const LastUserInteractDate = User.LastInteraction[source];
  if (moment(date).diff(LastUserInteractDate, 'seconds', true) <= 1) return true;
}

function getUserWarns(steamid) {
  return Warns[steamid] || 0;
}

function WarnUser(steamid) {
  if (!Object.prototype.hasOwnProperty.call(Warns, steamid)) Warns[steamid] = 0;
  Warns[steamid]++;
}

function RegisterUserInteract(userID64, UpdateCommentDate = false) {
  if (UpdateCommentDate) {
    User.LastComment[userID64] = Now();
    return;
  }

  User.LastInteraction[userID64] = Now();
}

async function canComment(UserID64) {
  return moment().diff(User.LastComment[UserID64], 'hours', true) >= 12;
}

async function sendAdminMessages(message) {
  Log.Debug('Sending a chat message for all admins..', false, config.DebugMode);

  for (let i = 0; i < config.admin.length; i++) {
    const Admin = config.admin[i];
    await sendChatMessage(Admin, message);
    await sleep(moment.duration(2, 'second'));
  }
}

module.exports = {
  Init,
  sendChatMessage,
  sendAdminMessages,
  canComment,
  UserInteract: RegisterUserInteract,
  WarnUser,
  getUserWarns,
  checkSpam,
};
