/**
 * XML Engine for dynamic Blockly bot modification
 */

export const updateScannerBotXML = (
    xmlString: string, 
    settings: { 
        symbol: string, 
        stake: string, 
        prediction: number,
        takeProfit: string,
        stopLoss: string 
    }
) => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

    // 1. Update Symbol
    const marketBlocks = xmlDoc.getElementsByTagName('block');
    for (let i = 0; i < marketBlocks.length; i++) {
        const block = marketBlocks[i];
        if (block.getAttribute('type') === 'trade_definition_market') {
            const fields = block.getElementsByTagName('field');
            for (let j = 0; j < fields.length; j++) {
                if (fields[j].getAttribute('name') === 'SYMBOL_LIST') {
                    fields[j].textContent = settings.symbol;
                }
            }
        }
    }

    // 2. Update Stake (AMOUNT)
    // In trade_definition_tradeoptions -> value name="AMOUNT" -> shadow/block -> field name="NUM"
    const valueNodes = xmlDoc.getElementsByTagName('value');
    for (let i = 0; i < valueNodes.length; i++) {
        const value = valueNodes[i];
        if (value.getAttribute('name') === 'AMOUNT') {
            const numFields = value.getElementsByTagName('field');
            for (let j = 0; j < numFields.length; j++) {
                if (numFields[j].getAttribute('name') === 'NUM') {
                    numFields[j].textContent = settings.stake;
                }
            }
        }
    }

    // 3. Update Prediction (if applicable)
    // We can add a prediction block if it doesn't exist, but usually it's in a specific trade type block.
    // For this PRD, we assume the bot is configured for DIGIT trades or we inject the prediction.

    return new XMLSerializer().serializeToString(xmlDoc);
};
