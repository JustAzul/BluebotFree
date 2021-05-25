const { readFileSync } = require('graceful-fs');
const { duration } = require('moment');
const { getAuthCode } = require('steam-totp');
const {
  Log, storeFile, readJSON, formatNumber, isSteamID64,
} = require('azul-tools');
const { DataStructures } = require('@doctormckay/stdlib');
const RequestDatabase = require('./RequestDatabase');
const {
  DebugLogs, sharedse, username, password, admin: AdminList,
} = require('../config/main');

let CardDatabase = {};

const Offers = new DataStructures.LeastUsedCache(Infinity, duration(10, 'minutes'));

let Profits = {
  tf2: {
    buy: {
      sets: 0,
      currency: 0,
    },
    sell: {
      sets: 0,
      currency: 0,
    },
  },
};

async function LoadLocalCardDatabase() {
  CardDatabase = await readJSON('data/database.json');
  if (Object.keys(CardDatabase).length > 0) {
    Log.Debug(`Successfuly loaded ${formatNumber(Object.keys(CardDatabase).length)} apps from local database!`, false, DebugLogs);
    return false;
  }
  return true;
}

function storeData(filename, data, json = false) {
  return storeFile(`data/${filename}`, json ? JSON.stringify(data) : data, 'w');
}

async function UpdateDatabase() {
  Log.Debug('Updating card sets Database..', false, DebugLogs);
  const FreshDatabase = await RequestDatabase();
  await storeData('database.json', FreshDatabase, true);
  Log.Debug(`Database up to date!, Found ${formatNumber(Object.keys(FreshDatabase).length)} apps with cards!`, false, DebugLogs);
}

async function Init() {
  try {
    Profits = JSON.parse(readFileSync(`${process.cwd()}/data/profits.json`)) || Profits;
  } catch {}

  const AwaitUpdate = await LoadLocalCardDatabase();
  if (AwaitUpdate) await UpdateDatabase();
  else UpdateDatabase();

  setInterval(() => {
    UpdateDatabase();
  }, duration(12, 'hours'));
}

async function getSetsCount(appid) {
  if (Object.prototype.hasOwnProperty.call(CardDatabase, appid)) return CardDatabase[appid];
  return 0;
}

function getProfits() {
  return Profits;
}

function isTradeOfferRepeated(OfferID) {
  return Offers.get(OfferID);
}

function newTradeOfferFinished(OfferID) {
  Offers.add(OfferID, true);
}

async function UpdateProfits(BuySets = 0, BuyCurrency = 0, SellSets = 0, SellCurrency = 0) {
  Profits.tf2.buy.sets += BuySets;
  Profits.tf2.buy.currency += BuyCurrency;

  Profits.tf2.sell.sets += SellSets;
  Profits.tf2.sell.currency += SellCurrency;

  return storeData('profits.json', this.Profits, true);
}

async function UpdateProfit(SellInfoType, SellInfoCurrency, _sets, _currency) {
  switch (SellInfoType) {
    case 0:
      // sold
      if (SellInfoCurrency === 'tf key(s)') UpdateProfits(0, 0, _sets, _currency);
      break;
    case 1:
      // bought
      if (SellInfoCurrency === 'tf key(s)') UpdateProfits(_sets, _currency);
      break;
    default:
      break;
  }
}

function Now() {
  return new Date().getTime();
}

function getLogOn() {
  return {
    accountName: username,
    password,
    rememberPassword: true,
  };
}

async function GenerateSteamGuardToken() {
  return getAuthCode(sharedse);
}

async function ExpForLevel(level = 0) {
  let exp = 0;

  for (let i = 1; i <= level; i++) {
    exp += Math.ceil(i / 10) * 100; // Current level exp
  }

  return exp;
}

function fixNumber(number, x) {
  return parseFloat(number.toFixed(x));
}

function isSteamCommonError(ErrorMessage = '', LowerCase = false) {
  if (LowerCase) ErrorMessage = ErrorMessage.toLowerCase();
  if (ErrorMessage.indexOf('socket hang up') !== -1) return true;
  if (ErrorMessage.indexOf('EBUSY') !== -1) return true;
  if (ErrorMessage === 'ETIMEDOUT') return true;
  if (ErrorMessage === 'ESOCKETTIMEDOUT') return true;
  return false;
}

function isAdmin(SteamID64 = '') {
  return AdminList.indexOf(SteamID64) !== -1;
}

function GetCommandFromMessage(Message = '', RemovePrefix = false) {
  const SplitValues = Message.split(' ');
  const Result = SplitValues[0];

  if (RemovePrefix) return Result.replace(/[!]/g, '');

  return Result.toLowerCase();
}

async function ParseIntegerInputs(Message = '', MinimalInputValue = 0, MaxInputValue = Number.MAX_SAFE_INTEGER) {
  const SplitValues = Message.split(' ');

  if (SplitValues.length === 2) {
    const InputValue = parseInt(SplitValues[1], 10);

    if (!InputValue || Number.isNaN(InputValue)) {
      const ReceivedCommand = SplitValues[0];
      throw new Error(`Try ${ReceivedCommand} [amount]`);
    }

    if (InputValue > MaxInputValue) throw new Error(`The amount value should be ${MaxInputValue} or lower`);
    if (InputValue < MinimalInputValue) throw new Error(`The amount value should be ${MinimalInputValue} or higher.`);

    return InputValue;
  }

  const ReceivedCommand = SplitValues[0];
  throw new Error(`Try ${ReceivedCommand} [amount]`);
}

// Returns SteamID64 if true
async function isInputSteamID64(Message = '') {
  const SplitResult = Message.split(' ');

  if (!SplitResult) return false;

  const FirstInput = SplitResult[1];
  const Result = await isSteamID64(FirstInput);

  if (Result) return FirstInput;

  return false;
}

module.exports = {
  Init,

  GenerateSteamGuardToken,
  getLogOn,

  isAdmin,

  isInputSteamID64,
  ParseIntegerInputs,
  GetCommandFromMessage,

  isSteamCommonError,
  ExpForLevel,
  fixNumber,

  getSetsCount,
  getProfits,

  isTradeOfferRepeated,
  newTradeOfferFinished,

  UpdateProfits: UpdateProfit,

  Now,
};
