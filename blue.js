const
	SteamUser = require('steam-user'),
	moment = require('moment'),
	helper = require('./components/helpers.js'),
	SteamCommunity = require('steamcommunity'),
	Inventory = require('./components/inventory.js'),
	customer = require('./components/userhandler.js'),
	TradeOfferManager = require('steam-tradeoffer-manager'),
	config = require('./config/main.js'),
	rates = require('./config/rates.json'),
	msg = require('./config/messages.json'),
	{EOL:BR} = require('os');

require('events').EventEmitter.defaultMaxListeners = 0;

const {	Log, storeChatData, formatNumber } = require('azul-tools');

let client = new SteamUser(),
	didLogin = false,
	community = new SteamCommunity(),
	manager = new TradeOfferManager({
		"steam": client,
		"language": "en",
		"community": community,
		"pollInterval": moment.duration(20, 'seconds'),
		"cancelTime": moment.duration(2, 'hours'),
		"savePollData": true
	}),
	inventory = new Inventory(community, client),
	timeouts = {},

	tfkeySets = rates.SellPrice,
	tfkeyBuySets = rates.BuyPrice;

(async () => {
	await helper.Init();
	await customer.Init(client);
	login();
})();

function login() {
	try {
		if (didLogin) return client.logOn(true);
		client.logOn(helper.getLogOn());
		Log('Connecting to Steam..');
	} catch (e) {
		//Already LoggedIn
	}
}

function webLogin() {
	try {
		client.webLogOn();
	} catch (e) {
		//not logged in
	}
}

client.once('accountLimitations', (limited, communityBanned, locked) => {
	if (limited) {
		Log.Error("This account is limited!");
		client.logOff();
	} else if (communityBanned) {
		Log.Error("This account is banned from community!");
		client.logOff();
	} else if (locked) {
		Log.Error("This account is locked!");
		client.logOff();
	}
});

client.once('loggedOn', () => {
	if (config.changeBotName) client.setPersona(SteamUser.EPersonaState.Online, config.changeBotName.replace("{rate}", `${tfkeySets}:1`));
	if (config.SteamSupply.Enabled) inventory.startCatalogLoop();
});

client.on('loggedOn', () => {
	didLogin = true;
	client.setPersona(SteamUser.EPersonaState.Online);
	Log("Conecting to SteamCommunity..");
});

client.on('groupRelationship', (GroupID, relationship) => {
	if (relationship == SteamUser.EClanRelationship.Invited) client.respondToGroupInvite(GroupID, false);
});

client.on('steamGuard', (domain, callback) => {
	helper.GenerateSteamGuardToken().then(callback);
});

client.on('webSession', (sessionID, newCookie) => {
	Log.Debug("webLogOn", false, config.DebugLogs);
	loadmanager(newCookie);
});

function loadmanager(newCookie) {
	manager.setCookies(newCookie, async err => {
		if (err) return loadmanager(newCookie);

		if (!inventory.apiKey) Log(`Successfully loaded API Key!`);

		inventory.apiKey = manager.apiKey;
		community.startConfirmationChecker(1000 * 20, config.identity);

		await inventory.Load();
		online();

		clearInterval(timeouts['CheckL_i']);
		timeouts['CheckL_i'] = setInterval(checkSteamLogged, moment.duration(10, "minutes"));
	});
}

client.on('disconnected', () => Log("Unexpected Disconnection!"));

client.on('error', ({eresult}) => {
	switch (eresult) {
		case SteamUser.EResult.AccountDisabled:
			Log.Error(`This account is disabled!`);
			break;
		case SteamUser.EResult.InvalidPassword:
			Log.Error(`Invalid Password detected!`);
			break;
		case SteamUser.EResult.RateLimitExceeded:
			const Minutes = 25;
			Log.Warn(`Rate Limit Exceeded, trying to login again in ${Minutes} minutes.`);
			setTimeout(() => {login();}, moment.duration(Minutes, "minutes"));
			break;
		case SteamUser.EResult.LogonSessionReplaced:
			Log.Warn(`Unexpected Disconnection!, you have LoggedIn with this same account in another place..`);
			Log.Warn(`trying to login again in a sec.`);
			setTimeout(() => {login();}, moment.duration(5, "seconds"));
		default:
			Log.Warn("Unexpected Disconnection!, trying to login again in a sec.");
			setTimeout(() => {login();}, moment.duration(5, "seconds"));
			break;
	}
});

community.on('sessionExpired', () => webLogin());

community.on('confirmationAccepted', Confirmation => {
	Log.Debug(`confirmationAccepted #${Confirmation.id} with type ${Confirmation.type} triggered.`, false, config.DebugLogs);

	if (Confirmation.type !== SteamCommunity.ConfirmationType.Trade) return;

	Log.Debug(`Searching for details of #${Confirmation.creator}`, false, config.DebugLogs);

	manager.getOffer(Confirmation.creator, (err, {isOurOffer, partner}) => {
		if (err) return Log.Error(err.message);

		if (isOurOffer) {
			let response = msg.OfferSent;
			response += BR + msg.OfferSent2.replace("{url}", `https://steamcommunity.com/tradeoffer/${Confirmation.creator}`);
			customer.Message(partner, response);
			Log.Trade(`Successfully sent a trade offer for ${partner}`);
			return;
		}

		Log.Debug(`#${Confirmation.creator} with confirmation id #${Confirmation.id} isn't a trade offer sent by bot.`, false, config.DebugLogs);
	});
});

function checkFriendRequests() {
	for (let user in client.myFriends) {
		if (client.myFriends[user] === SteamUser.EFriendRelationship.RequestRecipient) addFriend(user);
	}
}

function addFriend(user) {
	client.addFriend(user, (err, result) => {
		if (err) return Log.Warn(`Failed to accept user #${user} friend request!: ${err.message}`);

		customer.Message(user, msg.Welcome.replace("{customer_name}", result));
		customer.UserInteract(user);
	});
}

function checkSteamLogged() {
	community.loggedIn((err, loggedIn) => {
		if (err) return setTimeout(() => checkSteamLogged(), moment.duration(5, "seconds"));

		if (!loggedIn) {
			Log.Debug("checkSteamLogged(): Session expired!", false, config.DebugLogs);
			webLogin();
			return;
		}

		client.setPersona(SteamUser.EPersonaState.LookingToTrade);
	});
}

function makeOffer(target, itemsFromMe, itemsFromThem, details, type, currency) {

	switch (type) {
		case 0:
			/* selling */
			Log.Trade(`Creating trade offer for #${target} with ${itemsFromMe.length} items (${details.split(":")[0]} sets) to send and ${itemsFromThem.length} items (${details.split(":")[1]} ${currency}) to receive`);
			break;
		case 1:
			/* buying */
			Log.Trade(`Creating trade offer for #${target} with ${itemsFromMe.length} items (${details.split(":")[1]} ${currency}) to send and ${itemsFromThem.length} items (${details.split(":")[0]} sets) to receive`);
			break;
		default:
			Log.Trade(`Creating trade offer for #${target} with ${itemsFromMe.length} items to send and ${itemsFromThem.length} items to receive`);
			break;
	}

	try {
		const
			offer = manager.createOffer(target),
			addMyItemsCount = offer.addMyItems(itemsFromMe),
			addTheirItemsCount = offer.addTheirItems(itemsFromThem);

		offer.data('SellInfo', details);
		offer.data('SellInfoType', type);
		offer.data('SellInfoCurrency', currency);

		offer.getUserDetails((err, me, them) => {
			if (err) {
				if (err.message.toLowerCase().indexOf("is not available to trade. more information will be") > -1) {
					customer.Message(target, msg.Trade_error1);
					Log.Trade(`#${target} is unavailable to trade`);
				} else Log.Error(err.message);
			} else {
				if (them.escrowDays) {
					customer.Message(target, msg.Trade_hold);
				} else {
					Log.Debug(`Sending offer for #${target}`, false, config.DebugLogs);
					offer.send((err, status) => {
						Log.Debug(`Offer #${offer.id} status: ${status}, err: ${err}`, false, config.DebugLogs);
						if (err) {
							if (err.message.toLowerCase().indexOf("sent too many trade offers") > 1) {
								customer.Message(target, msg.Trade_error2);
							} else if (err.message.toLowerCase().indexOf("please try again later. (26)") > 1) {
								Log.Warn("Error 26", 'offer.send');
								customer.Message(target, msg.Trade_error);
							} else {
								Log.Error(err.message);
								customer.Message(target, msg.Trade_error);
							}
						} else {
							manager.getOffer(offer.id, (err, myOffer) => {
								if (err) {
									Log.Error(err.message);
									customer.Message(target, msg.Trade_error);
									if (err.message.indexOf("socket hang up") > -1 || err.message.indexOf("ESOCKETTIMEDOUT") > -1) {
										webLogin();
									}
								} else {
									if (addMyItemsCount != myOffer.itemsToGive.length) {
										Log.Error('Cant add itemsFromMe, some item is missing in my inventory!');
										customer.Message(target, msg.Trade_error);
										myOffer.cancel();
									} else if (addTheirItemsCount != myOffer.itemsToReceive.length) {
										Log.Error('Cant add itemsFromThem, some item is missing in my inventory!');
										customer.Message(target, msg.Trade_error);
										myOffer.cancel();
									} else if (status == 'pending') {
										community.checkConfirmations();
									} else {
										let response = msg.OfferSent;
										response += BR + msg.OfferSent2.replace("{url}", `https://steamcommunity.com/tradeoffer/${offer.id}`);
										customer.Message(target, response);
										Log.Trade(`Successfully sent a trade offer for ${target}`);
									}
								}
							});
						}
					});
				}
			}
		});
	} catch (e) {
		customer.Message(target, msg.Trade_error);
	}
}

function playPrices() {
	const play = msg.play
		.replace("{have_sets}", formatNumber(inventory.haveSets()))
		.replace("{rate}", `${tfkeySets}:1`);

	client.gamesPlayed(play);
}

function online() {
	client.setPersona(SteamUser.EPersonaState.LookingToTrade);
	playPrices();
	checkFriendRequests();
}

manager.on('newOffer', Offer => {
	const partner = Offer.partner.getSteamID64();
	if (config.admin.indexOf(partner) > -1) {
		Log.Trade(`New offer from admin #${partner}`);
		Offer.accept((err, res) => {
			if (err) return Log.Warn("Unable to accept admin offer: " + err.message);

			if (res == "pending") {
				Log.Trade("Accepting admin offer..");
				community.checkConfirmations();
			} else {
				Log.Trade("Admin Offer accepeted!");
			}

		});
	}
});

manager.on('receivedOfferChanged', async ({id, state}) => {
	if (helper.isTradeOfferRepeated(id)) return;
	if (state !== TradeOfferManager.ETradeOfferState.Accepted) return;
	
	helper.newTradeOfferFinished(id);
	await inventory.Load(true);
	playPrices();
	client.setPersona(SteamUser.EPersonaState.LookingToTrade);	
});

manager.on('sentOfferChanged', async Offer => {

	if (helper.isTradeOfferRepeated(Offer.id)) return;
	if (Offer.state !== TradeOfferManager.ETradeOfferState.Accepted) return;

	helper.newTradeOfferFinished(Offer.id);

	await inventory.Load(true);
	playPrices();
	client.setPersona(SteamUser.EPersonaState.LookingToTrade);

	if (config.ThanksM && Offer.data('SellInfo') != 'admin') {
		postComment(Offer.partner, config.ThanksM);
		customer.Message(Offer.partner, msg.Thanks);
	}

	if (Offer.data('SellInfoType') != null) {
		const _sets = parseInt(Offer.data('SellInfo').split(":")[0]);
		const _currency = parseInt(Offer.data('SellInfo').split(":")[1]);

		helper.UpdateProfits(Offer.data('SellInfoType'), Offer.data('SellInfoCurrency'), _sets, _currency);

		const text = `#${Offer.partner.getSteamID64()} have accepted an trade offer!, i have ${Offer.data('SellInfoType')  == 0 ? `selled` : `buyed`} ${_sets} set(s) for ${_currency} ${Offer.data('SellInfoCurrency')}!`;
		Log.Trade(text);

		if (config.sellmsgs) customer.sendAdminMessages(text);
	}
});

async function postComment(Target, Comment = "") {
	const Target64 = Target.getSteamID64();
	if (!await customer.canComment(Target64)) return;
	return new Promise(resolve => {
		community.postUserComment(Target, Comment, err => {
			if (!err) {
				customer.UserInteract(Target64, true);
				return resolve();
			}

			setTimeout(() => resolve(postComment(...arguments)), moment.duration(1, 'minute'));
			Log.Debug(`Failed in post user #${Target} a comment, trying again in a minute. => ${err.message}`);

		});
	})
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
		const {Badges} = await inventory.getUserBadges(CustomerID, true, false);
		let Qty = 0;

		for (const AppID in inventory.AvailableSets) {
			let Max = 5;
			if (Badges.hasOwnProperty(AppID)) Qty -= Badges[AppID];
			Qty += Max;
		}

		if (Qty <= 0) {
			let response = msg.Donthave;
			if (inventory.HaveKeys() && config.enableSell) response += BR + msg.Sell_keys;
			customer.Message(CustomerID, response);
			return;
		}

		let response = msg.Check
			.replace("{have_sets}", formatNumber(Qty))
			.replace("{tf_price}", ((Qty / tfkeySets)).toFixed(1));

		response += msg.Check_i.replace("{buytf_qty}", parseInt(Qty / tfkeySets));
		customer.Message(CustomerID, response);

	} catch(err) {
		handleBadgeErrors(err, CustomerID);
	}

}

async function Buy(CustomerID, KeysAmount = 0, Compare = true, CollectorMode = false) {
	customer.Message(CustomerID, msg.CustomerRequest);

	let CustomerKeys = {
		Assets: [],
		Amount: 0
	};

	try {
		CustomerKeys.Assets = await inventory.return_CustomerTFKeys(CustomerID);
		CustomerKeys.Amount = CustomerKeys["Assets"].length;
	} catch (err) {
		handleInventoryErrors(err, CustomerID);
	}

	if (CustomerKeys.Amount <= 0) return customer.Message(CustomerID, msg.Sorrythem2.replace("{currency_name}", "tf keys"));
	if (CustomerKeys.Amount <= KeysAmount) return customer.Message(CustomerID, msg.them_need.replace("{currency_qty}", CustomerKeys.Amount).replace("{currency}", "tf keys").replace("{needed}", KeysAmount));

	const NeededBotSets = tfkeySets * KeysAmount;

	try {
		const toSend = await inventory.getAvailableSetsForCustomer(CustomerID, Compare, CollectorMode, NeededBotSets);
		if (toSend.length !== NeededBotSets) return customer.Message(CustomerID, msg.i_need.replace("{currency_qty}", toSend.length).replace("{currency}", "sets").replace("{needed}", NeededBotSets));

		const toReceive = await inventory.getToOfferKeys(CustomerKeys.Assets, KeysAmount);
		makeOffer(CustomerID, toSend, toReceive, `${NeededBotSets}:${KeysAmount}`, 0, "tf key(s)");
	} catch (err) {
		handleBadgeErrors(err, CustomerID);
	}
}

async function CheckAmount(CustomerID, Amount) {
	customer.Message(CustomerID, msg.CustomerRequest);

	try {
		const {player_level, player_xp} = await inventory.getUserBadges(CustomerID, false, false);
		
		const SetsAmount = Amount * tfkeySets;
		const xpWon = 100 * SetsAmount;
		const totalExp = player_xp + xpWon;

		let CurrentExp = 0;
		let Level = 0;

		do {
			Level++;

			if (Level > config.maxLevelComm) {
				let response = `I'm not allowed to calculate level above than ${config.maxLevelComm} :/`;
				response += `${BR}Sorry but can you try a lower level?`;
				customer.Message(CustomerID, response);
				can++;
				break;
			}

			CurrentExp = await helper.ExpForLevel(Level);

		} while (CurrentExp <= totalExp)

		Level--;

		const o = {
			"CustomerLevel": player_level,
			"NewLevel": Level
		};

		return o;
	} catch(err){
		handleBadgeErrors(err, CustomerID);
	}
}

async function Sell(source, KeysToSend) {
	const BotKeysAmount = inventory.HaveKeys();
	if (!BotKeysAmount) return customer.Message(source, msg.Sorryme2);

	if (BotKeysAmount < KeysToSend) {
		customer.Message(source, msg.i_need
			.replace("{currency_qty}", BotKeysAmount)
			.replace("{currency}", "tf keys")
			.replace("{needed}", KeysToSend));
		return;
	}

	customer.Message(source, msg.CustomerRequest);

	try {
		const CustomerSetsArray = await inventory.getCustomerSets(source, false);
		const SetsRequestAmount = parseInt((KeysToSend) * tfkeyBuySets);

		if (CustomerSetsArray.length <= 0) return customer.Message(source, msg.ThemDonthave);
		if (CustomerSetsArray.length < SetsRequestAmount) return customer.Message(source, msg.them_need.replace("{currency_qty}", +CustomerSetsArray.length).replace("{currency}", "sets").replace("{needed}", SetsRequestAmount));
		
		customer.Message(source, msg.SendingOffer);
		
		inventory.getToOfferSets(CustomerSetsArray, SetsRequestAmount, async toRequest => {
			const toSend = await inventory.getToOffer_TF_Keys(KeysToSend);
			makeOffer(source, toSend, [].concat.apply([], toRequest), `${SetsRequestAmount}:${KeysToSend}`, 1, "tf key(s)");
		});

	} catch (err) {
		handleInventoryErrors(err, source);
	}
}

async function sellcheck(source) {
	customer.Message(source, msg.CustomerRequest);

	try {
		CustomerSetsArray = await inventory.getCustomerSets(source, false);

		const CustomerSetsAmount = CustomerSetsArray.length;
		if (CustomerSetsAmount <= 0) return customer.Message(source, msg.ThemDonthave);

		let response = msg.SellCheck.replace("{amount}", CustomerSetsAmount)
			.replace("{tfkeys_amount}", parseInt((CustomerSetsAmount / tfkeyBuySets)))
			.replace("{tfsets_amount}", (tfkeyBuySets) * parseInt((CustomerSetsAmount / tfkeyBuySets)));

		response += msg.SellCheck_i2.replace("{selltf_qty}", parseInt((CustomerSetsAmount / tfkeyBuySets)));

		customer.Message(source, response);

	} catch (err) {
		handleInventoryErrors(err, source);
	}
}

function block(admin, target) {
	if (config.admin.indexOf(target) > -1) {
		customer.Message(admin, 'You can\'t block this user!');
	} else {
		client.blockUser(target, err => {
			if (err) return customer.Message(admin, 'Fail!, did you put the right SteamID64 ??');
			customer.Message(admin, `Successfully blocked user ${target} !`);
		});
	}
}

function unblock(admin, target) {
	if (config.admin.indexOf(target) > -1) {
		customer.Message(admin, BR + 'You can\'t unblock this user!');
	} else {
		client.unblockUser(target, err => {
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

	let response = `- I have sold `;
	response += `${formatNumber(profit.tf2.sell.sets)} sets for ${formatNumber(profit.tf2.sell.currency)} Tf keys`;

	response += `${BR}- I bought `;
	response += `${formatNumber(profit.tf2.buy.sets)} sets for ${formatNumber(profit.tf2.buy.currency)} Tf keys`;

	customer.Message(admin, response);
}

async function dev(CustomerId) {
	client.inviteToGroup(CustomerId, "103582791458759521");
	let Response = `This bot was developed by Azul.`;
	Response += `{breakline}- If you want anything like code service, please contact me so we can chat :)`;
	Response += `{breakline}• [Steam] - https://steamcommunity.com/profiles/76561198177999769`
	Response += `{breakline}• [Github] - http://git.justazul.xyz`
	Response += `{breakline}• [Discord] - http://discord.justazul.xyz`
	Response += `{breakline}• [Reddit] - http://reddit.justazul.xyz`
	return Response;
}

async function level(source, DesiredLevel = 0) {
	customer.Message(source, msg.CustomerRequest);

	try {
		const {player_level, player_xp} = await inventory.getUserBadges(source, false, false);
		
		if (DesiredLevel < player_level) return customer.Message(source, `You've already reached level ${DesiredLevel}!!`);

		const needed = Math.ceil(((await helper.ExpForLevel(parseInt(DesiredLevel))) - player_xp) / 100);

		let response = msg.Level
			.replace("{needed}", needed).replace("{desired_level}", DesiredLevel)
			.replace("{price_tf}", ((needed / tfkeySets)).toFixed(1));

		response += BR + msg.Level2;
		customer.Message(source, response);
		
	} catch(err){
		handleBadgeErrors(err, source);
	}
}

function restart_() {
	Log('Restarting..');
	if (!client.steamID) return login();
	client.relog();
}

function shutdown() {
	Log('Shutdown requested, bye..');

	try {
		client.logOff();
		client.once('disconnected', () => process.exit(1));
	} catch (e) {
		process.exit(1);
	}

	setTimeout(() => process.exit(1), 1500);
}

client.chat.on('friendMessage', async ({steamid_friend:source, server_timestamp, message_no_bbcode:message}) => {

	if (message.indexOf('[tradeoffer sender=') > -1) return; //we don't need to handle that	
	storeChatData(source, message, false, server_timestamp);
	
	if (await customer.checkSpam(source, server_timestamp) == true) {
		customer.WarnUser(source);
		const UserWarns = customer.getUserWarns(source);

		if (UserWarns == 1) return customer.Message(source, msg.SpamWarn1);
		if (UserWarns == 2) return customer.Message(source, msg.SpamWarn2);

		if (UserWarns <= 5) {
			customer.Message(source, msg.SpamWarn3);
			customer.sendAdminMessages(`User #${source} has sending to much messages and have been removed from bot friendlist!`);
			Log.Warn(`User #${source} has sending to much messages and have been removed from bot friendlist!`);

			client.removeFriend(source);
			return;
		}
	}

	customer.UserInteract(source);
	const m = message.toLowerCase();

	if (inventory.CumulativeLoads) {
		if (m.indexOf('!buy') > -1 || m.indexOf('!sell') > -1 || m.indexOf('!gemswithdraw') > -1 || m.indexOf('!withdraw') > -1 || m.indexOf('!deposit') > -1 | m.indexOf('!tfdeposit') > -1 | m.indexOf('!tfwithdraw') > -1) {
			return customer.Message(source, msg.Loading);
		}
	}

	if (m == "!help" || m == "!commands ") {
		let response = 'Commands:';
		response += BR + '!owner - show my owner profile, if you have any problems you may contact me!';
		response += BR + '!stats - show current bot amount of currencies';
		response += BR + '!prices to see our prices';
		response += BR;
		response += BR + '!level [your dream level] - calculate how many sets and how many keys it\'ll cost to desired level';
		response += BR + '!check - show how many sets the bot have available and how much you can craft';
		response += BR + '!check [amount] - show how many sets and which level you would reach for a specific amount of keys';
		response += BR;
		response += BR + '!buy [amount of Tf keys] - use to buy that amount of Tf keys for sets you dont have, following the current BOT rate';
		response += BR + '!buyany [amount of Tf keys] - use to buy that amount of Tf keys for any sets, following the current BOT rate';
		response += BR + '!buyone [amount of Tf keys] - use this if you are a badge collector. BOT will send only one set of each game, following the current BOT rate';

		response += BR;
		if (config.enableSell) {
			response += BR + '!sell [amount of Tf keys] - sell your sets for TfKey(s)';
			response += BR + '!sellcheck - show information about the set(s) you can sell';
		}
		customer.Message(source, response);
	} else if (m == '!dev' || m == '!proof' || m == '!developer' || m == '!azul') {
		customer.Message(source, await dev(source));		
	} else if (m.indexOf("!check") > -1) {
		if (m.split(" ")[1]) {
			parseInputs(message, source, 1, async inputs => {
				if (inputs) {
					const {CustomerLevel, NewLevel} = await CheckAmount(source, inputs);
					if(CustomerLevel !== NewLevel) {
						customer.Message(source, `With ${inputs} tf2 key(s) you'll get ${parseInt(inputs)*tfkeySets} set(s) and reach level ${NewLevel}, interested? try !buy ${parseInt(inputs)}`);
					} else {
						customer.Message(source, `With ${inputs} tf2 key(s) you'll get ${parseInt(inputs)*tfkeySets} set(s) but'll stay on level ${CustomerLevel}, interested? try !buy ${parseInt(inputs)}`);
					}
				}
			}, config.maxTradeKeys);
		} else {
			check(source);
		}
	} else if (m == '!prices' || m == '!price' || m == '!rate' || m == '!rates') {
		let response = `The currently prices are ${tfkeySets} set(s) for a tf Key, also we're buying ${tfkeyBuySets} sets for 1 Tf Key`;
		response += BR;
		response += `${BR}Type !help for more information!`;
		customer.Message(source, response);

	} else if (m.indexOf('!level') > -1) {
		parseInputs(message, source, 1, inputs => {
			if (inputs) level(source, inputs);
		}, config.maxLevelComm);
	} else if (m.indexOf('!buy') > -1) {
		parseInputs(message, source, 1, inputs => {
			if (inputs) Buy(source, inputs, true, false);
		}, config.maxTradeKeys);
	} else if (m.indexOf('!buyone') > -1) {
		parseInputs(message, source, 1, inputs => {
			if (inputs) Buy(source, inputs, true, true);
		}, config.maxTradeKeys);
	} else if (m.indexOf('!buyany') > -1) {
		parseInputs(message, source, 1, inputs => {
			if (inputs) Buy(source, inputs, false, false);
		}, config.maxTradeKeys);
	} else if (m.indexOf('!sellcheck') > -1 && config.enableSell) {
		sellcheck(source);
	} else if (m.indexOf('!sell') > -1 && config.enableSell) {
		parseInputs(message, source, 1, inputs => {
			if (inputs) Sell(source, inputs);
		}, config.maxTradeKeys);
	} else if (m == '!owner') {
		let response = "There is something wrong?";
		response += BR + "Let me know if you're experiencing issues with my bot!";

		config.admin.forEach(target => {
			response += `${BR}https://steamcommunity.com/profiles/${target}`;
		});

		customer.Message(source, response);
	} else if (m == '!stats') {
		stats(source);
	} else if (config.admin.indexOf(source.getSteamID64()) > -1) {
		if (m == '!admin') {
			let response = 'Admin Commands:';
			response += BR + '!block [SteamID64] - block user';
			response += BR + '!unblock [SteamID64] - unblock user';
			response += BR;
			response += BR + '!profit - show bot buys and sells';
			response += BR;
			response += BR + '!restart - restart the bot(logoff and login)';
			response += BR + '!shutdown - logoff bot and close application';
			customer.Message(source, response);
		} else if (m == '!profit') {
			_profit(source);
		} else if (m.indexOf('!block') > -1) {
			isId64(message, source, sid => {
				if (sid) block(source, sid);
			});
		} else if (m.indexOf('!unblock') > -1) {
			isId64(message, source, sid => {
				if (sid) unblock(source, sid);
			});
		} else if (m == '!restart') {
			customer.Message(source, "I'll be back in a minute!");
			restart_();
		} else if (m == '!shutdown') {
			customer.Message(source, "I going down :(");
			shutdown();
		} else {
			customer.Message(source, msg.UnknowAdmin);
		}
	} else {
		customer.Message(source, msg.Unknow);
	}

});

client.on('friendRelationship', (steamid, relationship) => {
	if (relationship === SteamUser.EFriendRelationship.RequestRecipient) addFriend(steamid);
});

function isId64(message, target, callback) {
	const sid = message.split(" ")[1];

	if (/[0-9]{17}/.test(sid)) callback(sid);
	else {
		customer.Message(target, `Try ${message.split(" ")[0]} [SteamId64]`);
		callback(0);
	}
}

function parseInputs(message, target, min, callback, max) {
	const
		qty = parseInt(message.split(" ")[1]),
		isNumber = !(isNaN(qty));

	if (isNumber) {
		if (!(qty >= min)) {
			customer.Message(target, `The amount value should be ${min} or higher.`);
			callback(0);
		} else {
			if (max && qty > max) {
				customer.Message(target, `The amount value should be ${max} or lower`);
				callback(0);
			} else callback(qty);
		}
	} else {
		customer.Message(target, `Try ${message.split(" ")[0]} [amount]`);
		callback(0);
	}
}

function handleInventoryErrors(err, target) {
	if (err.message.indexOf("profile is private") > -1) customer.Message(target, msg.Inventory_priv);
	else {
		Log.Error(err.message);
		customer.Message(target, msg.Inventory_error);
	}
}

function handleBadgeErrors(err, source) {
	if (err.message == 'empty') customer.Message(source, "I can't look at your badges if your profile is private, can you make it public for me? ty ^^");
	else {
		Log.Error(err.message);
		customer.Message(source, msg.Badge_error);
	}
}