const {SteamSupply, maxStock, maxTradeKeys, enableSell} = require('../config/main.js');
const request = require('request');
const Rates = require('../config/rates.json');

module.exports = SendData;

async function SendData(Tf2KeysAmount = 0) {

    let SteamSupplyData = {
        "tf2buyrate": 0,
        "csgobuyrate": 0,
        "gembuyrate": 0
    };

    //Old pubg data
    SteamSupplyData["pubgamount"] = 0;
    SteamSupplyData["pubgrate"] = 0;
    SteamSupplyData["pubgbuyrate"] = 0;

    //Not supported data
    SteamSupplyData["gemamount"] = 0;
    SteamSupplyData["csgoamount"] = 0;
    SteamSupplyData["gemrate"] = 0;
    SteamSupplyData["csgorate"] = 0;
    SteamSupplyData["csgobuyrate"] = 0;
    SteamSupplyData["gembuyrate"] = 0;

    //Bot Setup Data
    SteamSupplyData["maxTradeKeys"] = maxTradeKeys;
    SteamSupplyData["maxStock"] = maxStock;

    //Inventory Amount
    SteamSupplyData["tf2amount"] = Tf2KeysAmount;

    //Sell Rate    
    SteamSupplyData["tf2rate"] = Rates.SellPrice;

    //Buy Rate
    if (enableSell) SteamSupplyData["tf2buyrate"] = Rates.BuyPrice;

    if(SteamSupply.Api === "") throw new Error("Steam.Supply API its empty!");

    const o = {
        "baseUrl": "https://steam.supply/API/",
        "uri": SteamSupply.Api + "/update/",
        "qs": SteamSupplyData
    };

    request(o);
}