/**
 * functions to interact with your node(s)
 *
 * Never use your paymentQueries on a public internetconnection unless you have
 **/

const request = require('sync-request');

var queryNode = '';
var paymentNode = '';
module.exports = {
    setQueryNode: function(nodeName) {
        queryNode = nodeName;
    },
    setPaymentNode: function (nodeName) {
        paymentNode = nodeName;
    },
    getDataFromNode: function(command) {
        return JSON.parse(request('GET', queryNode + command, {
            'headers': {
                'Connection': 'keep-alive'
            }
        }).getBody('utf8'));
    },
    /**
     * Method to return info about assets which are used in this script to pay a part of the wavesfees to
     *
     * @returns Object with assetinfo
     **/
    getAssetInfo: function(assetId) {
        var url = queryNode + '/assets/details/' + assetId + '?full=true';
        return JSON.parse(request('GET', url, {'headers': {
                'Connection': 'keep-alive'
            }
        }).getBody('utf8'));
    },
    /**
     *
     * @param assetId
     * @param blockHeight
     * @returns {{addresses: {}, totalDistributed: number}}
     */
    getAssetDistributionAtBlock: function (assetId, blockHeight, leaseWallet) {
        var addresses = {};
        var moreData = true;
        var first = true;
        var url = '';
        var response = {};
        var totalAssets = 0;
        while (moreData) {
            url = queryNode + '/assets/' + assetId + '/distribution/' + blockHeight + '/limit/1000';
            if (!first) {
                url += '?after=' + response.lastItem;
            }
            response = JSON.parse(request('GET', url,{
                'headers': {
                    'Connection': 'keep-alive'
                }
            }).getBody('utf8'));
            moreData = response.hasNext;
            for (address in response.items) {
                if (address !== leaseWallet) {
                    addresses[address] = response.items[address];
                    totalAssets += response.items[address];
                }
            }
            first = false;
        }
        return {addresses: addresses, totalDistributed: totalAssets};
    },
    /**
     * Read all fees genereted by the given block
     * @param block
     * @returns {number}
     */
    getFeesFromBlock: function (block) {
        blockFee = 0;
        block.transactions.forEach(function(transaction) {
            if (!transaction.feeAsset || transaction.feeAsset === '' || transaction.feeAsset === null) {
                if (transaction.fee < (2 * Math.pow(10, 8))) {
                    blockFee += transaction.fee;
                } else {
                    console.log("Filtered TX at block " + block.height + ". WavesFee of " + (transaction.fee / Math.pow(10, 8)).toFixed(8));
                }
            } else if (transaction.type === 4) {
                blockFee += 100000
            }
        });
        return blockFee;
    }

};