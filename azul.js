const SteamUser = require('steam-user');
const moment = require('moment');
const SteamCommunity = require('steamcommunity');
const TradeOfferManager = require('steam-tradeoffer-manager');
const { EOL: BR } = require('os');
const {
  Log, storeChatData, formatNumber, sleep,
} = require('azul-tools');
const helper = require('./components/helpers');
const Inventory = require('./components/inventory');
const customer = require('./components/userhandler');
const config = require('./config/main');
const rates = require('./config/rates.json');
const msg = require('./config/messages.json');

require('events').EventEmitter.defaultMaxListeners = 0;

const Client = new SteamUser();
const Community = new SteamCommunity();
const Manager = new TradeOfferManager({
  steam: Client,
  language: 'en',
  community: Community,
  pollInterval: moment.duration(20, 'seconds'),
  cancelTime: moment.duration(2, 'hours'),
  savePollData: true,
});

const inventory = new Inventory(Community, Client);

let didLogin = false;
const { SellPrice: tfkeySets, BuyPrice: tfkeyBuySets } = rates;

function login() {
  try {
    if (didLogin) {
      Client.logOn(true);
      return;
    }

    Client.logOn(helper.getLogOn());
    Log('Connecting to Steam..');
  } catch {}
}

(async () => {
  Log('Initing handy functions..');
  await helper.Init();
  Log('Initing customer manager..');
  await customer.Init(Client);
  login();
})();

function webLogin() {
  try {
    Client.webLogOn();
  } catch (e) {
    // not logged in
  }
}

Client.once('accountLimitations', (limited, communityBanned, locked) => {
  if (limited) {
    Log.Error('This account is limited!');
    Client.logOff();
  } else if (communityBanned) {
    Log.Error('This account is banned from community!');
    Client.logOff();
  } else if (locked) {
    Log.Error('This account is locked!');
    Client.logOff();
  }
});

Client.once('loggedOn', () => {
  if (config.changeBotName) Client.setPersona(SteamUser.EPersonaState.Online, config.changeBotName.replace('{rate}', `${tfkeySets}:1`));
  if (config.SteamSupply.Enabled) inventory.startCatalogLoop();
});

Client.on('loggedOn', () => {
  didLogin = true;
  Client.setPersona(SteamUser.EPersonaState.Online);
  Log('Conecting to SteamCommunity..');
});

Client.on('groupRelationship', (GroupID, relationship) => {
  if (relationship === SteamUser.EClanRelationship.Invited) Client.respondToGroupInvite(GroupID, false);
});

Client.on('steamGuard', (domain, callback) => {
  helper.GenerateSteamGuardToken().then(callback);
});

function checkSteamLogged() {
  Community.loggedIn((err, loggedIn) => {
    if (err) return setTimeout(() => checkSteamLogged(), moment.duration(5, 'seconds'));

    if (!loggedIn) {
      Log.Debug('checkSteamLogged(): Session expired!', false, config.DebugLogs);
      webLogin();
      return;
    }

    Client.setPersona(SteamUser.EPersonaState.LookingToTrade);
  });
}

function playPrices() {
  const play = msg.play
    .replace('{have_sets}', formatNumber(inventory.haveSets()))
    .replace('{rate}', `${tfkeySets}:1`);

  Client.gamesPlayed(play);
}

function addFriend(user) {
  Client.addFriend(user, (err, result) => {
    if (err) return Log.Warn(`Failed to accept user #${user} friend request!: ${err.message}`);

    customer.Message(user, msg.Welcome.replace('{customer_name}', result));
    customer.UserInteract(user);
  });
}

function checkFriendRequests() {
  let keys = Object.keys(Client.myFriends || {});
  for (let i = 0; i < keys.length; i++) {
    const user = keys[i];
    if (Client.myFriends[user] === SteamUser.EFriendRelationship.RequestRecipient) addFriend(user);
  }
  keys = null;
}

function online() {
  Client.setPersona(SteamUser.EPersonaState.LookingToTrade);
  playPrices();
  checkFriendRequests();
}

function loadmanager(newCookie) {
  Manager.setCookies(newCookie, async (err) => {
    if (err) {
      await sleep(moment.duration(5, 'seconds'));
      loadmanager(newCookie);
      return;
    }

    inventory.apiKey = Manager.apiKey; Community.startConfirmationChecker(1000 * 20, config.identity); if (!inventory.apiKey) {
      Log('Successfully loaded API Key!');
      setInterval(checkSteamLogged, moment.duration(10, 'minutes'));
    }

    await inventory.Load();
    online();
  });
}

Client.on('webSession', (sessionID, newCookie) => {
  Log.Debug('webLogOn', false, config.DebugLogs);
  loadmanager(newCookie);
});

Client.on('disconnected', () => Log('Unexpected Disconnection!'));

Client.on('error', ({ eresult }) => {
  switch (eresult) {
    case SteamUser.EResult.AccountDisabled:
      Log.Error('This account is disabled!');
      break;
    case SteamUser.EResult.InvalidPassword:
      Log.Error('Invalid Password detected!');
      break;
    case SteamUser.EResult.RateLimitExceeded:
    {
      const Minutes = 25;
      Log.Warn(`Rate Limit Exceeded, trying to login again in ${Minutes} minutes.`);
      setTimeout(() => { login(); }, moment.duration(Minutes, 'minutes'));
      break;
    }
    case SteamUser.EResult.LogonSessionReplaced:
      Log.Warn('Unexpected Disconnection!, you have LoggedIn with this same account in another place..');
      Log.Warn('trying to login again in a sec.');
      setTimeout(() => { login(); }, moment.duration(5, 'seconds'));
      break;
    default:
      Log.Warn('Unexpected Disconnection!, trying to login again in a sec.');
      setTimeout(() => { login(); }, moment.duration(5, 'seconds'));
      break;
  }
});

Community.on('sessionExpired', () => webLogin());

Community.on('confirmationAccepted', (Confirmation) => {
  Log.Debug(`confirmationAccepted #${Confirmation.id} with type ${Confirmation.type} triggered.`, false, config.DebugLogs);

  if (Confirmation.type !== SteamCommunity.ConfirmationType.Trade) return;

  Log.Debug(`Searching for details of #${Confirmation.creator}`, false, config.DebugLogs);

  Manager.getOffer(Confirmation.creator, (err, { isOurOffer, partner }) => {
    if (err) return Log.Error(err.message);

    if (isOurOffer) {
      let response = msg.OfferSent;
      response += BR + msg.OfferSent2.replace('{url}', `https://steamcommunity.com/tradeoffer/${Confirmation.creator}`);
      customer.Message(partner, response);
      Log.Trade(`Successfully sent a trade offer for ${partner}`);
      return;
    }

    Log.Debug(`#${Confirmation.creator} with confirmation id #${Confirmation.id} isn't a trade offer sent by bot.`, false, config.DebugLogs);
  });
});

function makeOffer(CustomerID, itemsFromMe = [], itemsFromThem = [], details = {}, type, currency) {
  switch (type) {
    case 0:
      /* selling */
      Log.Trade(`Creating trade offer for #${CustomerID} with ${itemsFromMe.length} items (${details.split(':')[0]} sets) to send and ${itemsFromThem.length} items (${details.split(':')[1]} ${currency}) to receive`);
      break;
    case 1:
      /* buying */
      Log.Trade(`Creating trade offer for #${CustomerID} with ${itemsFromMe.length} items (${details.split(':')[1]} ${currency}) to send and ${itemsFromThem.length} items (${details.split(':')[0]} sets) to receive`);
      break;
    default:
      Log.Trade(`Creating trade offer for #${CustomerID} with ${itemsFromMe.length} items to send and ${itemsFromThem.length} items to receive`);
      break;
  }

  try {
    const Offer = Manager.createOffer(CustomerID);

    Offer.addMyItems(itemsFromMe);
    Offer.addTheirItems(itemsFromThem);

    Offer.data('SellInfo', details);
    Offer.data('SellInfoType', type);
    Offer.data('SellInfoCurrency', currency);

    Offer.getUserDetails((UserDetailError, me, them) => {
      if (UserDetailError) {
        if (UserDetailError.message.toLowerCase().indexOf('is not available to trade. more information will be') > -1) {
          customer.Message(CustomerID, msg.Trade_error1);
          Log.Trade(`#${CustomerID} is unavailable to trade`);
          return;
        }

        return Log.Error(UserDetailError.message);
      }

      if ((them.escrowDays + me.escrowDays) > 0) return customer.Message(CustomerID, msg.Trade_hold);

      Log.Debug(`Sending offer for #${CustomerID}`, false, config.DebugLogs);
      Offer.send((OfferError, OfferStatus) => {
        if (OfferError) {
          if (OfferError.message.toLowerCase().indexOf('sent too many trade offers') > 1) {
            customer.Message(CustomerID, msg.Trade_error2);
            return;
          }

          throw OfferError;
        }

        Manager.getOffer(Offer.id, (err /* , myOffer */) => {
          if (err) {
            Log.Error(err.message);
            if (helper.isSteamCommonError(err.message)) webLogin();
            throw err;
          }

          if (OfferStatus === 'pending') return Community.checkConfirmations();

          let response = msg.OfferSent;
          response += BR + msg.OfferSent2.replace('{url}', `https://steamcommunity.com/tradeoffer/${Offer.id}`);
          customer.Message(CustomerID, response);
          Log.Trade(`Successfully sent a trade offer for ${CustomerID}`);
        });
      });
    });
  } catch (e) {
    customer.Message(CustomerID, msg.Trade_error);
  }
}

Manager.on('newOffer', (Offer) => {
  const partner = Offer.partner.getSteamID64();
  if (config.admin.indexOf(partner) > -1) {
    Log.Trade(`New offer from admin #${partner}`);
    Offer.accept((err, res) => {
      if (err) return Log.Warn(`Unable to accept admin offer: ${err.message}`);

      if (res === 'pending') {
        Log.Trade('Accepting admin offer..');
        Community.checkConfirmations();
      } else {
        Log.Trade('Admin Offer accepeted!');
      }
    });
  }
});

Manager.on('receivedOfferChanged', async ({ id, state }) => {
  if (helper.isTradeOfferRepeated(id)) return;
  if (state !== TradeOfferManager.ETradeOfferState.Accepted) return;

  helper.newTradeOfferFinished(id);
  await inventory.Load(true);
  playPrices();
  Client.setPersona(SteamUser.EPersonaState.LookingToTrade);
});

async function postComment(Target, Comment = '') {
  const Target64 = typeof Target.getSteamID64 === 'function' ? Target.getSteamID64() : Target;
  if (!(await customer.canComment(Target64))) return null;

  return new Promise((resolve) => {
    Community.postUserComment(Target, Comment, (err) => {
      if (!err) {
        customer.UserInteract(Target64, true);
        resolve();
        return;
      }

      setTimeout(() => resolve(postComment(...arguments)), moment.duration(1, 'minute'));
      Log.Debug(`Failed in post user #${Target} a comment, trying again in a minute. => ${err.message}`);
    });
  });
}

Manager.on('sentOfferChanged', async (Offer) => {
  if (helper.isTradeOfferRepeated(Offer.id)) return;
  if (Offer.state !== TradeOfferManager.ETradeOfferState.Accepted) return;

  helper.newTradeOfferFinished(Offer.id);

  await inventory.Load(true);
  playPrices();
  Client.setPersona(SteamUser.EPersonaState.LookingToTrade);

  if (config.ThanksM && Offer.data('SellInfo') !== 'admin') {
    postComment(Offer.partner, config.ThanksM);
    customer.Message(Offer.partner, msg.Thanks);
  }

  if (Offer.data('SellInfoType') != null) {
    const _sets = parseInt(Offer.data('SellInfo').split(':')[0], 10);
    const _currency = parseInt(Offer.data('SellInfo').split(':')[1], 10);

    helper.UpdateProfits(Offer.data('SellInfoType'), Offer.data('SellInfoCurrency'), _sets, _currency);

    const text = `#${Offer.partner.getSteamID64()} have accepted an trade offer!, i have ${Offer.data('SellInfoType') === 0 ? 'selled' : 'buyed'} ${_sets} set(s) for ${_currency} ${Offer.data('SellInfoCurrency')}!`;
    Log.Trade(text);

    if (config.sellmsgs) customer.sendAdminMessages(text);
  }
});

function handleInventoryErrors(err, target) {
  if (err.message.indexOf('profile is private') > -1) customer.Message(target, msg.Inventory_priv);
  else {
    Log.Error(err.message);
    customer.Message(target, msg.Inventory_error);
  }
}

function handleBadgeErrors(err, source) {
  if (err.message === 'empty') customer.Message(source, "I can't look at your badges if your profile is private, can you make it public for me? ty ^^");
  else {
    Log.Error(err.message);
    customer.Message(source, msg.Badge_error);
  }
}

async function check(CustomerID) {
  customer.Message(CustomerID, msg.CustomerRequest);

  if (inventory.haveSets() <= 0) {
    let response = msg.Donthave;
    if (inventory.HaveKeys() && config.enableSell) response += BR + msg.Sell_keys;
    customer.Message(CustomerID, response);
    return;
  }

  try {
    const { Badges } = await inventory.getUserBadges(CustomerID, true, false);
    let Qty = 0;
    let keys = Object.keys(inventory.AvailableSets || {});
    for (let i = 0; i < keys.length; i++) {
      const AppID = keys[i];
      if (Object.prototype.hasOwnProperty.call(Badges, AppID)) Qty -= Badges[AppID];
      Qty += 5;
    }
    keys = null;

    if (Qty <= 0) {
      let response = msg.Donthave;
      if (inventory.HaveKeys() && config.enableSell) response += BR + msg.Sell_keys;
      customer.Message(CustomerID, response);
      return;
    }

    let response = msg.Check
      .replace('{have_sets}', formatNumber(Qty))
      .replace('{tf_price}', ((Qty / tfkeySets)).toFixed(1));

    response += msg.Check_i.replace('{buytf_qty}', parseInt(Qty / tfkeySets, 10));
    customer.Message(CustomerID, response);
  } catch (err) {
    handleBadgeErrors(err, CustomerID);
  }
}

async function Buy(CustomerID, KeysAmount = 0, Compare = true, CollectorMode = false) {
  customer.Message(CustomerID, msg.CustomerRequest);

  const CustomerKeys = {
    Assets: [],
    Amount: 0,
  };

  try {
    CustomerKeys.Assets = await inventory.return_CustomerTFKeys(CustomerID);
    CustomerKeys.Amount = CustomerKeys.Assets.length;
  } catch (err) {
    handleInventoryErrors(err, CustomerID);
  }

  if (CustomerKeys.Amount <= 0) return customer.Message(CustomerID, msg.Sorrythem2.replace('{currency_name}', 'tf keys'));
  if (CustomerKeys.Amount <= KeysAmount) return customer.Message(CustomerID, msg.them_need.replace('{currency_qty}', CustomerKeys.Amount).replace('{currency}', 'tf keys').replace('{needed}', KeysAmount));

  const NeededBotSets = tfkeySets * KeysAmount;

  try {
    const toSend = await inventory.getAvailableSetsForCustomer(CustomerID, Compare, CollectorMode, NeededBotSets);
    if (toSend.length !== NeededBotSets) return customer.Message(CustomerID, msg.i_need.replace('{currency_qty}', toSend.length).replace('{currency}', 'sets').replace('{needed}', NeededBotSets));

    const toReceive = await inventory.getToOfferKeys(CustomerKeys.Assets, KeysAmount);
    makeOffer(CustomerID, toSend, toReceive, `${NeededBotSets}:${KeysAmount}`, 0, 'tf key(s)');
  } catch (err) {
    handleBadgeErrors(err, CustomerID);
  }
}

async function CheckAmount(CustomerID, Amount) {
  customer.Message(CustomerID, msg.CustomerRequest);

  try {
    const { player_level: PlayerLevel, player_xp: PlayerXP } = await inventory.getUserBadges(CustomerID, false, false);

    const SetsAmount = Amount * tfkeySets;
    const xpWon = 100 * SetsAmount;
    const totalExp = PlayerXP + xpWon;

    let CurrentExp = 0;
    let Level = 0;

    do {
      Level++;

      if (Level > config.maxLevelComm) {
        let response = `I'm not allowed to calculate level above than ${Level} :/`;
        response += `${BR}Sorry but can you try a lower level?`;
        customer.Message(CustomerID, response);
        break;
      }

      CurrentExp = await helper.ExpForLevel(Level);
    } while (CurrentExp <= totalExp);

    Level--;

    const o = {
      CustomerLevel: PlayerLevel,
      NewLevel: Level,
    };

    return o;
  } catch (err) {
    handleBadgeErrors(err, CustomerID);
  }
}

async function Sell(source, KeysToSend) {
  const BotKeysAmount = inventory.HaveKeys();
  if (!BotKeysAmount) return customer.Message(source, msg.Sorryme2);

  if (BotKeysAmount < KeysToSend) {
    customer.Message(source, msg.i_need
      .replace('{currency_qty}', BotKeysAmount)
      .replace('{currency}', 'tf keys')
      .replace('{needed}', KeysToSend));
    return;
  }

  customer.Message(source, msg.CustomerRequest);

  try {
    const CustomerSetsArray = await inventory.getCustomerSets(source, false);
    const SetsRequestAmount = parseInt((KeysToSend) * tfkeyBuySets, 10);

    if (CustomerSetsArray.length <= 0) return customer.Message(source, msg.ThemDonthave);
    if (CustomerSetsArray.length < SetsRequestAmount) return customer.Message(source, msg.them_need.replace('{currency_qty}', +CustomerSetsArray.length).replace('{currency}', 'sets').replace('{needed}', SetsRequestAmount));

    customer.Message(source, msg.SendingOffer);

    inventory.getToOfferSets(CustomerSetsArray, SetsRequestAmount, async (toRequest) => {
      const toSend = await inventory.getToOffer_TF_Keys(KeysToSend);
      makeOffer(source, toSend, [].concat.apply([], toRequest), `${SetsRequestAmount}:${KeysToSend}`, 1, 'tf key(s)');
    });
  } catch (err) {
    handleInventoryErrors(err, source);
  }
}

async function sellcheck(source) {
  customer.Message(source, msg.CustomerRequest);

  try {
    const CustomerSetsArray = await inventory.getCustomerSets(source, false);

    const CustomerSetsAmount = CustomerSetsArray.length;
    if (CustomerSetsAmount <= 0) return customer.Message(source, msg.ThemDonthave);

    let response = msg.SellCheck.replace('{amount}', CustomerSetsAmount)
      .replace('{tfkeys_amount}', parseInt((CustomerSetsAmount / tfkeyBuySets), 10))
      .replace('{tfsets_amount}', (tfkeyBuySets) * parseInt((CustomerSetsAmount / tfkeyBuySets), 10));

    response += msg.SellCheck_i2.replace('{selltf_qty}', parseInt((CustomerSetsAmount / tfkeyBuySets), 10));

    customer.Message(source, response);
  } catch (err) {
    handleInventoryErrors(err, source);
  }
}

function block(admin, target) {
  if (config.admin.indexOf(target) > -1) {
    customer.Message(admin, 'You can\'t block this user!');
  } else {
    Client.blockUser(target, (err) => {
      if (err) return customer.Message(admin, 'Fail!, did you put the right SteamID64 ??');
      customer.Message(admin, `Successfully blocked user ${target} !`);
    });
  }
}

function unblock(admin, target) {
  if (config.admin.indexOf(target) > -1) {
    customer.Message(admin, `${BR}You can't unblock this user!`);
  } else {
    Client.unblockUser(target, (err) => {
      if (err) return customer.Message(admin, 'Fail!, did you put the right SteamID64 ??');
      customer.Message(admin, `Successfully unblocked user ${target} !`);
    });
  }
}

function stats(source) {
  const response = `I currently have ${formatNumber(inventory.haveSets())} sets and ${inventory.HaveKeys()} Tf key(s) on my inventory.`;
  customer.Message(source, response);
}

function _profit(admin) {
  const profit = helper.getProfits();

  let response = '- I have sold ';
  response += `${formatNumber(profit.tf2.sell.sets)} sets for ${formatNumber(profit.tf2.sell.currency)} Tf keys`;

  response += `${BR}- I bought `;
  response += `${formatNumber(profit.tf2.buy.sets)} sets for ${formatNumber(profit.tf2.buy.currency)} Tf keys`;

  customer.Message(admin, response);
}

async function dev(CustomerId) {
  Client.inviteToGroup(CustomerId, '103582791458759521');
  let Response = 'This bot was developed by Azul.';
  Response += '{breakline}- If you want anything like code service, please contact me so we can chat :)';
  Response += '{breakline}• [Steam] - https://steamcommunity.com/profiles/76561198177999769';
  Response += '{breakline}• [Github] - http://git.justazul.xyz';
  Response += '{breakline}• [Discord] - http://discord.justazul.xyz';
  Response += '{breakline}• [Reddit] - http://reddit.justazul.xyz';
  return Response;
}

async function level(source, DesiredLevel = 0) {
  customer.Message(source, msg.CustomerRequest);

  try {
    const { player_level: PlayerLevel, player_xp: PlayerXP } = await inventory.getUserBadges(source, false, false);

    if (DesiredLevel < PlayerLevel) return customer.Message(source, `You've already reached level ${DesiredLevel}!!`);

    const needed = Math.ceil(((await helper.ExpForLevel(parseInt(DesiredLevel, 10))) - PlayerXP) / 100);

    let response = msg.Level
      .replace('{needed}', needed).replace('{desired_level}', DesiredLevel)
      .replace('{price_tf}', ((needed / tfkeySets)).toFixed(1));

    response += BR + msg.Level2;
    customer.Message(source, response);
  } catch (err) {
    handleBadgeErrors(err, source);
  }
}

function restart_() {
  Log('Restarting..');
  if (!Client.steamID) return login();
  Client.relog();
}

function shutdown() {
  Log('Shutdown requested, bye..');

  try {
    Client.logOff();
    Client.once('disconnected', () => process.exit(1));
  } catch (e) {
    process.exit(1);
  }

  setTimeout(() => process.exit(1), 1500);
}

function parseInputs(message, target, min, callback, max) {
  const qty = parseInt(message.split(' ')[1], 10);
  const isNumber = !(Number.isNaN(qty));

  if (isNumber) {
    if (!(qty >= min)) {
      customer.Message(target, `The amount value should be ${min} or higher.`);
      callback(0);
    } else if (max && qty > max) {
      customer.Message(target, `The amount value should be ${max} or lower`);
      callback(0);
    } else callback(qty);
  } else {
    customer.Message(target, `Try ${message.split(' ')[0]} [amount]`);
    callback(0);
  }
}

function isId64(message, target, callback) {
  const sid = message.split(' ')[1];

  if (/[0-9]{17}/.test(sid)) callback(sid);
  else {
    customer.Message(target, `Try ${message.split(' ')[0]} [SteamId64]`);
    callback(0);
  }
}

Client.chat.on('friendMessage', async ({ steamid_friend: source, server_timestamp: ServerTimeStamp, message_no_bbcode: message }) => {
  if (message.indexOf('[tradeoffer sender=') > -1) return; // we don't need to handle that
  storeChatData(source, message, false, ServerTimeStamp);

  if (await customer.checkSpam(source, ServerTimeStamp) === true) {
    customer.WarnUser(source);
    const UserWarns = customer.getUserWarns(source);

    if (UserWarns === 1) return customer.Message(source, msg.SpamWarn1);
    if (UserWarns === 2) return customer.Message(source, msg.SpamWarn2);

    if (UserWarns <= 5) {
      customer.Message(source, msg.SpamWarn3);
      customer.sendAdminMessages(`User #${source} has sending to much messages and have been removed from bot friendlist!`);
      Log.Warn(`User #${source} has sending to much messages and have been removed from bot friendlist!`);

      Client.removeFriend(source);
      return;
    }
  }

  customer.UserInteract(source);
  const m = message.toLowerCase();

  if (inventory.CumulativeLoads) {
    if (m.indexOf('!buy') > -1 || m.indexOf('!sell') > -1 || m.indexOf('!gemswithdraw') > -1 || m.indexOf('!withdraw') > -1 || m.indexOf('!deposit') > -1 || m.indexOf('!tfdeposit') > -1 || m.indexOf('!tfwithdraw') > -1) {
      return customer.Message(source, msg.Loading);
    }
  }

  if (m === '!help' || m === '!commands ') {
    let response = 'Commands:';
    response += `${BR}!owner - show my owner profile, if you have any problems you may contact me!`;
    response += `${BR}!stats - show current bot amount of currencies`;
    response += `${BR}!prices to see our prices`;
    response += BR;
    response += `${BR}!level [your dream level] - calculate how many sets and how many keys it'll cost to desired level`;
    response += `${BR}!check - show how many sets the bot have available and how much you can craft`;
    response += `${BR}!check [amount] - show how many sets and which level you would reach for a specific amount of keys`;
    response += BR;
    response += `${BR}!buy [amount of Tf keys] - use to buy that amount of Tf keys for sets you dont have, following the current BOT rate`;
    response += `${BR}!buyany [amount of Tf keys] - use to buy that amount of Tf keys for any sets, following the current BOT rate`;
    response += `${BR}!buyone [amount of Tf keys] - use this if you are a badge collector. BOT will send only one set of each game, following the current BOT rate`;

    response += BR;
    if (config.enableSell) {
      response += `${BR}!sell [amount of Tf keys] - sell your sets for TfKey(s)`;
      response += `${BR}!sellcheck - show information about the set(s) you can sell`;
    }
    customer.Message(source, response);
  } else if (m === '!dev' || m === '!proof' || m === '!developer' || m === '!azul') {
    customer.Message(source, await dev(source));
  } else if (m.indexOf('!check') > -1) {
    if (m.split(' ')[1]) {
      parseInputs(message, source, 1, async (inputs) => {
        if (inputs) {
          const { CustomerLevel, NewLevel } = await CheckAmount(source, inputs);
          if (CustomerLevel !== NewLevel) {
            customer.Message(source, `With ${inputs} tf2 key(s) you'll get ${parseInt(inputs, 10) * tfkeySets} set(s) and reach level ${NewLevel}, interested? try !buy ${parseInt(inputs, 10)}`);
          } else {
            customer.Message(source, `With ${inputs} tf2 key(s) you'll get ${parseInt(inputs, 10) * tfkeySets} set(s) but'll stay on level ${CustomerLevel}, interested? try !buy ${parseInt(inputs, 10)}`);
          }
        }
      }, config.maxTradeKeys);
    } else {
      check(source);
    }
  } else if (m === '!prices' || m === '!price' || m === '!rate' || m === '!rates') {
    let response = `The currently prices are ${tfkeySets} set(s) for a tf Key, also we're buying ${tfkeyBuySets} sets for 1 Tf Key`;
    response += BR;
    response += `${BR}Type !help for more information!`;
    customer.Message(source, response);
  } else if (m.indexOf('!level') > -1) {
    parseInputs(message, source, 1, (inputs) => {
      if (inputs) level(source, inputs);
    }, config.maxLevelComm);
  } else if (m.indexOf('!buy') > -1) {
    parseInputs(message, source, 1, (inputs) => {
      if (inputs) Buy(source, inputs, true, false);
    }, config.maxTradeKeys);
  } else if (m.indexOf('!buyone') > -1) {
    parseInputs(message, source, 1, (inputs) => {
      if (inputs) Buy(source, inputs, true, true);
    }, config.maxTradeKeys);
  } else if (m.indexOf('!buyany') > -1) {
    parseInputs(message, source, 1, (inputs) => {
      if (inputs) Buy(source, inputs, false, false);
    }, config.maxTradeKeys);
  } else if (m.indexOf('!sellcheck') > -1 && config.enableSell) {
    sellcheck(source);
  } else if (m.indexOf('!sell') > -1 && config.enableSell) {
    parseInputs(message, source, 1, (inputs) => {
      if (inputs) Sell(source, inputs);
    }, config.maxTradeKeys);
  } else if (m === '!owner') {
    let response = 'There is something wrong?';
    response += `${BR}Let me know if you're experiencing issues with my bot!`;

    config.admin.forEach((target) => {
      response += `${BR}https://steamcommunity.com/profiles/${target}`;
    });

    customer.Message(source, response);
  } else if (m === '!stats') {
    stats(source);
  } else if (config.admin.indexOf(source.getSteamID64()) > -1) {
    if (m === '!admin') {
      let response = 'Admin Commands:';
      response += `${BR}!block [SteamID64] - block user`;
      response += `${BR}!unblock [SteamID64] - unblock user`;
      response += BR;
      response += `${BR}!profit - show bot buys and sells`;
      response += BR;
      response += `${BR}!restart - restart the bot(logoff and login)`;
      response += `${BR}!shutdown - logoff bot and close application`;
      customer.Message(source, response);
    } else if (m === '!profit') {
      _profit(source);
    } else if (m.indexOf('!block') > -1) {
      isId64(message, source, (sid) => {
        if (sid) block(source, sid);
      });
    } else if (m.indexOf('!unblock') > -1) {
      isId64(message, source, (sid) => {
        if (sid) unblock(source, sid);
      });
    } else if (m === '!restart') {
      customer.Message(source, "I'll be back in a minute!");
      restart_();
    } else if (m === '!shutdown') {
      customer.Message(source, 'I going down :(');
      shutdown();
    } else {
      customer.Message(source, msg.UnknowAdmin);
    }
  } else {
    customer.Message(source, msg.Unknow);
  }
});

Client.on('friendRelationship', (steamid, relationship) => {
  if (relationship === SteamUser.EFriendRelationship.RequestRecipient) addFriend(steamid);
});
