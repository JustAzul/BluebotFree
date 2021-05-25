const SteamUser = require('steam-user');
const moment = require('moment');
const SteamCommunity = require('steamcommunity');
const TradeOfferManager = require('steam-tradeoffer-manager');
const { EOL: BR } = require('os');
const {
  Log, storeChatData, formatNumber, sleep, Pattern,
} = require('azul-tools');
const Helper = require('./components/helpers');
const Inventory = require('./components/inventory');
const UserHandler = require('./components/userhandler');

const config = require('./config/main');
const rates = require('./config/rates.json');
const msg = require('./config/messages.json');
const helpers = require('./components/helpers');

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

let FirstLoginAttemptDone = false;
const { SellPrice: tfkeySets, BuyPrice: tfkeyBuySets } = rates;

function login() {
  try {
    if (FirstLoginAttemptDone) return Client.logOn(true);
    Client.logOn(Helper.getLogOn());
    Log('Connecting to Steam..');
  } catch {
    // Do Nothing..
  }
}

(async () => {
  Pattern();
  Log('Initing handy functions..');
  await Helper.Init();
  Log('Initing customer manager..');
  await UserHandler.Init(Client);
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
  FirstLoginAttemptDone = true;
  Client.setPersona(SteamUser.EPersonaState.Online);
  Log('Conecting to SteamCommunity..');
});

Client.on('groupRelationship', (GroupID, relationship) => {
  if (relationship === SteamUser.EClanRelationship.Invited) Client.respondToGroupInvite(GroupID, false);
});

Client.on('steamGuard', (domain, callback) => {
  Helper.GenerateSteamGuardToken().then(callback);
});

function CheckSteamLogin() {
  Community.loggedIn((err, loggedIn) => {
    if (err) return setTimeout(() => CheckSteamLogin(), moment.duration(5, 'seconds'));

    if (!loggedIn) {
      Log.Debug('CheckSteamLogin(): Session expired!', false, config.DebugLogs);
      webLogin();
      return;
    }

    Client.setPersona(SteamUser.EPersonaState.LookingToTrade);
  });
}

function DisplayPrices() {
  const play = msg.play
    .replace('{have_sets}', formatNumber(inventory.haveSets()))
    .replace('{rate}', `${tfkeySets}:1`);

  Client.gamesPlayed(play);
}

function addFriend(user) {
  Client.addFriend(user, (err, result) => {
    if (err) return Log.Warn(`Failed to accept user #${user} friend request!: ${err.message}`);

    UserHandler.sendChatMessage(user, msg.Welcome.replace('{customer_name}', result));
    UserHandler.UserInteract(user);
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

function BotOnlineStatus() {
  Client.setPersona(SteamUser.EPersonaState.LookingToTrade);
  DisplayPrices();
  checkFriendRequests();
}

function SetupTradeManager(newCookie) {
  Manager.setCookies(newCookie, async (err) => {
    if (err) {
      await sleep(moment.duration(5, 'seconds'));
      SetupTradeManager(newCookie);
      return;
    }

    inventory.apiKey = Manager.apiKey;

    Community.startConfirmationChecker(moment.duration(20, 'seconds'), config.identity);

    if (!inventory.apiKey) {
      Log('Successfully loaded API Key!');
      setInterval(CheckSteamLogin, moment.duration(10, 'minutes'));
    }

    await inventory.Load();
    BotOnlineStatus();
  });
}

Client.on('webSession', (sessionID, newCookie) => {
  Log.Debug('webLogOn', false, config.DebugLogs);
  SetupTradeManager(newCookie);
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

Community.on('sessionExpired', webLogin);

Community.on('confirmationAccepted', (Confirmation) => {
  Log.Debug(`confirmationAccepted #${Confirmation.id} with type ${Confirmation.type} triggered.`, false, config.DebugLogs);

  if (Confirmation.type !== SteamCommunity.ConfirmationType.Trade) return;

  Log.Debug(`Searching for details of #${Confirmation.creator}`, false, config.DebugLogs);

  Manager.getOffer(Confirmation.creator, (err, { isOurOffer, partner }) => {
    if (err) return Log.Error(err.message);

    if (isOurOffer) {
      let response = msg.OfferSent;
      response += BR + msg.OfferSent2.replace('{url}', `https://steamcommunity.com/tradeoffer/${Confirmation.creator}`);
      UserHandler.sendChatMessage(partner, response);
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
        if (UserDetailError.message.toLowerCase().indexOf('is not available to trade. more information will be') !== -1) {
          UserHandler.sendChatMessage(CustomerID, msg.Trade_error1);
          Log.Trade(`#${CustomerID} is unavailable to trade`);
          return;
        }

        return Log.Error(UserDetailError.message);
      }

      const EscrowDays = (them.escrowDays + me.escrowDays);
      if (EscrowDays > 0) return UserHandler.sendChatMessage(CustomerID, msg.Trade_hold);

      Log.Debug(`Sending offer for #${CustomerID}`, false, config.DebugLogs);
      Offer.send((OfferError, OfferStatus) => {
        if (OfferError) {
          if (OfferError.message.toLowerCase().indexOf('sent too many trade offers') !== -1) {
            UserHandler.sendChatMessage(CustomerID, msg.Trade_error2);
            return;
          }

          throw OfferError;
        }

        Manager.getOffer(Offer.id, (err /* , myOffer */) => {
          if (err) {
            Log.Error(err.message);
            if (Helper.isSteamCommonError(err.message)) webLogin();
            throw err;
          }

          if (OfferStatus === 'pending') return Community.checkConfirmations();

          let response = msg.OfferSent;
          response += BR + msg.OfferSent2.replace('{url}', `https://steamcommunity.com/tradeoffer/${Offer.id}`);
          UserHandler.sendChatMessage(CustomerID, response);
          Log.Trade(`Successfully sent a trade offer for ${CustomerID}`);
        });
      });
    });
  } catch (e) {
    UserHandler.sendChatMessage(CustomerID, msg.Trade_error);
  }
}

Manager.on('newOffer', (Offer) => {
  const PartnerID64 = Offer.partner.getSteamID64();

  if (!helpers.isAdmin(PartnerID64)) return;

  Log.Trade(`New offer from admin #${PartnerID64}`);
  Offer.accept((err, res) => {
    if (err) return Log.Warn(`Unable to accept admin offer: ${err.message}`);

    if (res === 'pending') {
      Log.Trade('Accepting admin offer..');
      Community.checkConfirmations();
    } else Log.Trade('Admin Offer accepeted!');
  });
});

Manager.on('receivedOfferChanged', async ({ id, state }) => {
  if (Helper.isTradeOfferRepeated(id)) return;
  if (state !== TradeOfferManager.ETradeOfferState.Accepted) return;

  Helper.newTradeOfferFinished(id);
  await inventory.Load(true);
  DisplayPrices();
  Client.setPersona(SteamUser.EPersonaState.LookingToTrade);
});

async function postComment(Target, Comment = '') {
  const TargetID64 = typeof Target.getSteamID64 === 'function' ? Target.getSteamID64() : Target;
  if (!(await UserHandler.canComment(TargetID64))) return null;

  return new Promise((resolve) => {
    Community.postUserComment(Target, Comment, (err) => {
      if (!err) {
        UserHandler.UserInteract(TargetID64, true);
        resolve();
        return;
      }

      setTimeout(() => resolve(postComment(...arguments)), moment.duration(1, 'minute'));
      Log.Debug(`Failed in post user #${Target} a comment, trying again in a minute. => ${err.message}`);
    });
  });
}

Manager.on('sentOfferChanged', async (Offer) => {
  if (Helper.isTradeOfferRepeated(Offer.id)) return;
  if (Offer.state !== TradeOfferManager.ETradeOfferState.Accepted) return;

  Helper.newTradeOfferFinished(Offer.id);

  await inventory.Load(true);
  DisplayPrices();
  Client.setPersona(SteamUser.EPersonaState.LookingToTrade);

  if (config.ThanksM && Offer.data('SellInfo') !== 'admin') {
    postComment(Offer.partner, config.ThanksM);
    UserHandler.sendChatMessage(Offer.partner, msg.Thanks);
  }

  if (Offer.data('SellInfoType') != null) {
    const SetsSent = parseInt(Offer.data('SellInfo').split(':')[0], 10);
    const ReceivedCurrencyAmount = parseInt(Offer.data('SellInfo').split(':')[1], 10);

    Helper.UpdateProfits(Offer.data('SellInfoType'), Offer.data('SellInfoCurrency'), SetsSent, ReceivedCurrencyAmount);

    const text = `#${Offer.partner.getSteamID64()} have accepted an trade offer!, i have ${Offer.data('SellInfoType') === 0 ? 'sold' : 'bought'} ${SetsSent} set(s) for ${ReceivedCurrencyAmount} ${Offer.data('SellInfoCurrency')}!`;
    Log.Trade(text);

    if (config.sellmsgs) UserHandler.sendAdminMessages(text);
  }
});

function handleInventoryErrors(err, target) {
  if (err.message.indexOf('profile is private') !== -1) UserHandler.sendChatMessage(target, msg.Inventory_priv);
  else {
    Log.Error(err.message);
    UserHandler.sendChatMessage(target, msg.Inventory_error);
  }
}

function handleBadgeErrors(err, source) {
  if (err.message === 'empty') UserHandler.sendChatMessage(source, "I can't look at your badges if your profile is private, can you make it public for me? ty ^^");
  else {
    Log.Error(err.message);
    UserHandler.sendChatMessage(source, msg.Badge_error);
  }
}

async function check(CustomerID) {
  UserHandler.sendChatMessage(CustomerID, msg.CustomerRequest);

  if (inventory.haveSets() <= 0) {
    let response = msg.Donthave;
    if (inventory.HaveKeys() && config.enableSell) response += BR + msg.Sell_keys;
    UserHandler.sendChatMessage(CustomerID, response);
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
      UserHandler.sendChatMessage(CustomerID, response);
      return;
    }

    let response = msg.Check
      .replace('{have_sets}', formatNumber(Qty))
      .replace('{tf_price}', ((Qty / tfkeySets)).toFixed(1));

    response += msg.Check_i.replace('{buytf_qty}', parseInt(Qty / tfkeySets, 10));
    UserHandler.sendChatMessage(CustomerID, response);
  } catch (err) {
    handleBadgeErrors(err, CustomerID);
  }
}

async function Buy(CustomerID, KeysAmount = 0, Compare = true, CollectorMode = false) {
  UserHandler.sendChatMessage(CustomerID, msg.CustomerRequest);

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

  if (CustomerKeys.Amount <= 0) return UserHandler.sendChatMessage(CustomerID, msg.Sorrythem2.replace('{currency_name}', 'tf keys'));
  if (CustomerKeys.Amount <= KeysAmount) return UserHandler.sendChatMessage(CustomerID, msg.them_need.replace('{currency_qty}', CustomerKeys.Amount).replace('{currency}', 'tf keys').replace('{needed}', KeysAmount));

  const NeededBotSets = tfkeySets * KeysAmount;

  try {
    const toSend = await inventory.getAvailableSetsForCustomer(CustomerID, Compare, CollectorMode, NeededBotSets);
    if (toSend.length !== NeededBotSets) return UserHandler.sendChatMessage(CustomerID, msg.i_need.replace('{currency_qty}', toSend.length).replace('{currency}', 'sets').replace('{needed}', NeededBotSets));

    const toReceive = await inventory.getToOfferKeys(CustomerKeys.Assets, KeysAmount);
    makeOffer(CustomerID, toSend, toReceive, `${NeededBotSets}:${KeysAmount}`, 0, 'tf key(s)');
  } catch (err) {
    handleBadgeErrors(err, CustomerID);
  }
}

async function CheckAmount(CustomerID, Amount) {
  UserHandler.sendChatMessage(CustomerID, msg.CustomerRequest);

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
        UserHandler.sendChatMessage(CustomerID, response);
        break;
      }

      CurrentExp = await Helper.ExpForLevel(Level);
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
  if (!BotKeysAmount) return UserHandler.sendChatMessage(source, msg.Sorryme2);

  if (BotKeysAmount < KeysToSend) {
    UserHandler.sendChatMessage(source, msg.i_need
      .replace('{currency_qty}', BotKeysAmount)
      .replace('{currency}', 'tf keys')
      .replace('{needed}', KeysToSend));
    return;
  }

  UserHandler.sendChatMessage(source, msg.CustomerRequest);

  try {
    const CustomerSetsArray = await inventory.getCustomerSets(source, false);
    const SetsRequestAmount = parseInt((KeysToSend) * tfkeyBuySets, 10);

    if (CustomerSetsArray.length <= 0) return UserHandler.sendChatMessage(source, msg.ThemDonthave);
    if (CustomerSetsArray.length < SetsRequestAmount) return UserHandler.sendChatMessage(source, msg.them_need.replace('{currency_qty}', +CustomerSetsArray.length).replace('{currency}', 'sets').replace('{needed}', SetsRequestAmount));

    UserHandler.sendChatMessage(source, msg.SendingOffer);

    inventory.getToOfferSets(CustomerSetsArray, SetsRequestAmount, async (toRequest) => {
      const toSend = await inventory.getToOffer_TF_Keys(KeysToSend);
      makeOffer(source, toSend, [].concat.apply([], toRequest), `${SetsRequestAmount}:${KeysToSend}`, 1, 'tf key(s)');
    });
  } catch (err) {
    handleInventoryErrors(err, source);
  }
}

async function sellcheck(source) {
  UserHandler.sendChatMessage(source, msg.CustomerRequest);

  try {
    const CustomerSetsArray = await inventory.getCustomerSets(source, false);

    const CustomerSetsAmount = CustomerSetsArray.length;
    if (CustomerSetsAmount <= 0) return UserHandler.sendChatMessage(source, msg.ThemDonthave);

    let response = msg.SellCheck.replace('{amount}', CustomerSetsAmount)
      .replace('{tfkeys_amount}', parseInt((CustomerSetsAmount / tfkeyBuySets), 10))
      .replace('{tfsets_amount}', (tfkeyBuySets) * parseInt((CustomerSetsAmount / tfkeyBuySets), 10));

    response += msg.SellCheck_i2.replace('{selltf_qty}', parseInt((CustomerSetsAmount / tfkeyBuySets), 10));

    UserHandler.sendChatMessage(source, response);
  } catch (err) {
    handleInventoryErrors(err, source);
  }
}

function block(admin, target) {
  if (Helper.isAdmin(admin)) {
    UserHandler.sendChatMessage(admin, 'You can\'t block this user!');
    return;
  }

  Client.blockUser(target, (err) => {
    if (err) return UserHandler.sendChatMessage(admin, 'Fail!, did you put the right SteamID64 ??');
    UserHandler.sendChatMessage(admin, `Successfully blocked user ${target} !`);
  });
}

function unblock(admin, target) {
  Client.unblockUser(target, (err) => {
    if (err) return UserHandler.sendChatMessage(admin, 'Fail!, did you put the right SteamID64 ??');
    UserHandler.sendChatMessage(admin, `Successfully unblocked user ${target} !`);
  });
}

function stats(source) {
  const response = `I currently have ${formatNumber(inventory.haveSets())} sets and ${inventory.HaveKeys()} Tf key(s) on my inventory.`;
  UserHandler.sendChatMessage(source, response);
}

function TradingCounts(admin) {
  const profit = Helper.getProfits();

  let Response = '- I have sold ';
  Response += `${formatNumber(profit.tf2.sell.sets)} sets for ${formatNumber(profit.tf2.sell.currency)} Tf keys`;

  Response += `${BR}- I bought `;
  Response += `${formatNumber(profit.tf2.buy.sets)} sets for ${formatNumber(profit.tf2.buy.currency)} Tf keys`;

  UserHandler.sendChatMessage(admin, Response);
}

function dev(CustomerId) {
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
  UserHandler.sendChatMessage(source, msg.CustomerRequest);

  try {
    const { player_level: PlayerLevel, player_xp: PlayerXP } = await inventory.getUserBadges(source, false, false);

    if (DesiredLevel < PlayerLevel) return UserHandler.sendChatMessage(source, `You've already reached level ${DesiredLevel}!!`);

    const needed = Math.ceil(((await Helper.ExpForLevel(parseInt(DesiredLevel, 10))) - PlayerXP) / 100);

    let response = msg.Level
      .replace('{needed}', needed).replace('{desired_level}', DesiredLevel)
      .replace('{price_tf}', ((needed / tfkeySets)).toFixed(1));

    response += BR + msg.Level2;
    UserHandler.sendChatMessage(source, response);
  } catch (err) {
    handleBadgeErrors(err, source);
  }
}

function SteamReconnect() {
  Log('Restarting..');
  if (!Client.steamID) return login();
  Client.relog();
}

function ShutdownApp() {
  Log('Shutdown requested, bye..');

  try {
    Client.logOff();
    Client.once('disconnected', () => process.exit(1));
  } catch (e) {
    process.exit(1);
  }

  setTimeout(() => process.exit(1), 1500);
}

Client.chat.on('friendMessage', async ({ steamid_friend: source, server_timestamp: ServerTimeStamp, message_no_bbcode: message }) => {
  if (message.indexOf('[tradeoffer sender=') !== -1) return; // we don't need to handle that

  const SouceID64 = typeof source.getSteamID64 === 'function' ? source.getSteamID64() : source;
  storeChatData(SouceID64, message, false, ServerTimeStamp);

  if (await UserHandler.checkSpam(SouceID64, ServerTimeStamp) === true) {
    UserHandler.WarnUser(SouceID64);
    const UserWarns = UserHandler.getUserWarns(SouceID64);

    if (UserWarns === 1) return UserHandler.sendChatMessage(source, msg.SpamWarn1);
    if (UserWarns === 2) return UserHandler.sendChatMessage(source, msg.SpamWarn2);

    if (UserWarns <= 5) {
      UserHandler.sendChatMessage(source, msg.SpamWarn3);
      UserHandler.sendAdminMessages(`User #${SouceID64} has sending to much messages and have been removed from bot friendlist!`);
      Log.Warn(`User #${SouceID64} has sending to much messages and have been removed from bot friendlist!`);

      Client.removeFriend(source);
      return;
    }
  }

  UserHandler.UserInteract(SouceID64);
  const m = message.toLowerCase();

  if (inventory.CumulativeLoads > 0) {
    const CommandList = ['!buy', '!sell', '!gemswithdraw', '!withdraw', '!deposit', '!tfdeposit', '!tfwithdraw'];
    const ReceivedCommand = Helper.GetCommandFromMessage(message, false);
    if (CommandList.indexOf(ReceivedCommand) !== -1) return UserHandler.sendChatMessage(source, msg.Loading);
  }

  const Commands = {
    Customer: {
      commands: () => {
        let Response = 'Commands:';

        Response += `${BR}!owner - show my owner profile, if you have any problems you may contact me!`;
        Response += `${BR}!stats - show current bot amount of currencies`;
        Response += `${BR}!prices to see our prices`;
        Response += BR;
        Response += `${BR}!level [your dream level] - calculate how many sets and how many keys it'll cost to desired level`;
        Response += `${BR}!check - show how many sets the bot have available and how much you can craft`;
        Response += `${BR}!check [amount] - show how many sets and which level you would reach for a specific amount of keys`;
        Response += BR;
        Response += `${BR}!buy [amount of Tf keys] - use to buy that amount of Tf keys for sets you dont have, following the current BOT rate`;
        Response += `${BR}!buyany [amount of Tf keys] - use to buy that amount of Tf keys for any sets, following the current BOT rate`;
        Response += `${BR}!buyone [amount of Tf keys] - use this if you are a badge collector. BOT will send only one set of each game, following the current BOT rate`;

        Response += BR;

        if (config.enableSell) {
          Response += `${BR}!sell [amount of Tf keys] - sell your sets for TfKey(s)`;
          Response += `${BR}!sellcheck - show information about the set(s) you can sell`;
        }

        UserHandler.sendChatMessage(source, Response);
      },
      developer: () => UserHandler.sendChatMessage(source, dev(source)),
      stats: () => stats(SouceID64),
      check: async () => {
        const HasInputs = (m.split(' ') || []).length > 0;

        if (HasInputs) {
          let InputValue;

          try {
            InputValue = await Helper.ParseIntegerInputs(message, 1, config.maxTradeKeys);
          } catch (e) {
            UserHandler.sendChatMessage(source, e.message);
            return;
          }

          const { CustomerLevel, NewLevel } = await CheckAmount(source, InputValue);

          if (CustomerLevel !== NewLevel) {
            UserHandler.sendChatMessage(source, `With ${InputValue} tf2 key(s) you'll get ${parseInt(InputValue, 10) * tfkeySets} set(s) and reach level ${NewLevel}, interested? try !buy ${parseInt(InputValue, 10)}`);
          } else {
            UserHandler.sendChatMessage(source, `With ${InputValue} tf2 key(s) you'll get ${parseInt(InputValue, 10) * tfkeySets} set(s) but'll stay on level ${CustomerLevel}, interested? try !buy ${parseInt(InputValue, 10)}`);
          }
        }

        check(source);
      },
      rates: () => {
        let Response = `The currently prices are ${tfkeySets} set(s) for a tf Key, also we're buying ${tfkeyBuySets} sets for 1 Tf Key`;
        Response += BR;
        Response += `${BR}Type !help for more information!`;
        UserHandler.sendChatMessage(source, Response);
      },
      level: async () => {
        let InputValue;

        try {
          InputValue = await Helper.ParseIntegerInputs(message, 1, config.maxLevelComm);
        } catch (e) {
          UserHandler.sendChatMessage(source, e.message);
          return;
        }

        level(source, InputValue);
      },
      owner: () => {
        let Response = 'There is something wrong?';
        Response += `${BR}Let me know if you're experiencing issues with my bot!`;

        for (let i = 0; i < config.admin.length; i += 1) {
          const AdminID64 = config.admin[i];
          Response += `${BR}https://steamcommunity.com/profiles/${AdminID64}`;
        }

        UserHandler.sendChatMessage(source, Response);
      },
      buy: async () => {
        let InputValue;

        try {
          InputValue = await Helper.ParseIntegerInputs(message, 1, config.maxTradeKeys);
        } catch (e) {
          UserHandler.sendChatMessage(source, e.message);
          return;
        }

        Buy(source, InputValue, true, false);
      },
      buyone: async () => {
        let InputValue;

        try {
          InputValue = await Helper.ParseIntegerInputs(message, 1, config.maxTradeKeys);
        } catch (e) {
          UserHandler.sendChatMessage(source, e.message);
          return;
        }

        Buy(source, InputValue, true, true);
      },
      buyany: async () => {
        let InputValue;

        try {
          InputValue = await Helper.ParseIntegerInputs(message, 1, config.maxTradeKeys);
        } catch (e) {
          UserHandler.sendChatMessage(source, e.message);
          return;
        }

        Buy(source, InputValue, false, false);
      },
    },
    Admin: {
      admin: () => {
        let Response = 'Admin Commands:';

        Response += `${BR}!block [SteamID64] - block user`;
        Response += `${BR}!unblock [SteamID64] - unblock user`;
        Response += BR;
        Response += `${BR}!profit - show bot buys and sells`;
        Response += BR;
        Response += `${BR}!restart - restart the bot(logoff and login)`;
        Response += `${BR}!shutdown - logoff bot and close application`;

        UserHandler.sendChatMessage(source, Response);
      },
      profits: () => TradingCounts(source),
      shutdown: () => {
        UserHandler.sendChatMessage(source, 'I going down :(');
        ShutdownApp();
      },
      restart: () => {
        UserHandler.sendChatMessage(source, "I'll be back in a minute!");
        SteamReconnect();
      },
      block: async () => {
        const SteamID64 = await Helper.isInputSteamID64(message, source);
        if (SteamID64) block(source, SteamID64);
        else UserHandler.sendChatMessage(source, 'Wrong format, model: !block [SteamID64]');
      },
      unblock: async () => {
        const SteamID64 = await Helper.isInputSteamID64(message, source);
        if (SteamID64) unblock(source, SteamID64);
        else UserHandler.sendChatMessage(source, 'Wrong format, model: !unblock [SteamID64]');
      },
    },
  };

  if (config.enableSell) {
    Commands.Customer.sell = async () => {
      let InputValue;

      try {
        InputValue = await Helper.ParseIntegerInputs(message, 1, config.maxTradeKeys);
      } catch (e) {
        UserHandler.sendChatMessage(source, e.message);
        return;
      }

      Sell(source, InputValue);
    };

    Commands.Customer.sellcheck = () => sellcheck(source);
  }

  const Alias = {
    Customer: {
      help: Commands.Customer.commands,
      azul: Commands.Customer.developer,
      proof: Commands.Customer.developer,
      dev: Commands.Customer.developer,
      prices: Commands.Customer.rates,
      price: Commands.Customer.rates,
      rate: Commands.Customer.rates,
    },
    /* Admin: {

    }, */
  };

  const ReceivedCommand = Helper.GetCommandFromMessage(message, true);

  if (Object.prototype.hasOwnProperty.call(Commands.Customer, `${ReceivedCommand}`)) return Commands.Customer[ReceivedCommand]();
  if (Object.prototype.hasOwnProperty.call(Alias.Customer, ReceivedCommand)) return Alias.Customer[ReceivedCommand]();

  if (Helper.isAdmin(SouceID64)) {
    if (Object.prototype.hasOwnProperty.call(Commands.Admin, ReceivedCommand)) return Commands.Admin[ReceivedCommand]();

    // We dont have any Admin alias, no need to check.
    // if (Object.prototype.hasOwnProperty.call(Alias.Admin, ReceivedCommand)) return Alias.Admin[ReceivedCommand]();
    return UserHandler.sendChatMessage(source, msg.UnknowAdmin);
  }

  UserHandler.sendChatMessage(source, msg.Unknow);
});

Client.on('friendRelationship', (steamid, relationship) => {
  if (relationship === SteamUser.EFriendRelationship.RequestRecipient) addFriend(steamid);
});
