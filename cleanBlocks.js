const fs = require('fs');
const configfile = 'config.json'

var config = JSON.parse(fs.readFileSync(configfile));

var blocks = JSON.parse(fs.readFileSync(config.toolbaseconfig.currentblocksfile));

var block = {};
for (height in blocks) {
    block = blocks[height];
    config.paymentconfig.assetHoldersPayments.forEach(function (asset) {
        if (asset.id in block) {
            assetHolders = block[asset.id].addresses;
            for (address in assetHolders) {
                if (assetHolders[address] < (asset.minimumAmountInWallet * Math.pow(10,8)) && !(address == "3PQHjaSLrgUGrAaUxzndnCWVxqSdWh1SL8m")) {
                    delete (assetHolders[address]);
                }
            }
        }
    });
    blocks[height] = block;
    console.info(block);
}

fs.copyFile(config.toolbaseconfig.currentblocksfile, 'blocks.json.bak', function (err) {
    if (err) {
        console.error(err);
    } else {
        console.info('Backup');
    }
});

fs.writeFile('cleanedBlocks.json', JSON.stringify(blocks, null, 4), {}, function (err) {
    if (err) {
        console.error(err);
    } else {
        console.info('Nieuwe');
    }

});