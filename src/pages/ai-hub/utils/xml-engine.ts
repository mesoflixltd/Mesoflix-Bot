/**
 * XML Engine for dynamic Blockly bot modification
 */

export const updateScannerBotXML = (
    xmlString: string, 
    settings: { 
        symbol: string, 
        stake: string, 
        prediction: number,
        martingale: string,
        takeProfit: string,
        stopLoss: string 
    }
) => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

    // 1. Update Symbol
    const blocks = xmlDoc.getElementsByTagName('block');
    for (let i = 0; i < blocks.length; i++) {
        if (blocks[i].getAttribute('type') === 'trade_definition_market') {
            const fields = blocks[i].getElementsByTagName('field');
            for (let j = 0; j < fields.length; j++) {
                if (fields[j].getAttribute('name') === 'SYMBOL_LIST') {
                    fields[j].textContent = settings.symbol;
                }
            }
        }
    }

    // 2. Update Numerical Values by Shadow/Block IDs
    // We'll use IDs set in our TEMPLATE_XML for precision
    const fields = xmlDoc.getElementsByTagName('field');
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        const parent = field.parentNode as Element | null;
        if (!parent) continue;
        
        const parentId = parent.getAttribute('id');
        
        if (parentId === 'amount_id_001') field.textContent = settings.stake;
        if (parentId === 'predict_id_001') field.textContent = settings.prediction.toString();
        if (parentId === 'martingale_id_001') field.textContent = settings.martingale;
        if (parentId === 'tp_id_001') field.textContent = settings.takeProfit;
        if (parentId === 'sl_id_001') field.textContent = settings.stopLoss;

        // Special: Update Purchase List based on signal
        if (field.getAttribute('name') === 'PURCHASE_LIST') {
            field.textContent = settings.prediction === 1 ? 'DIGITOVER' : 'DIGITUNDER';
        }
    }

    return new XMLSerializer().serializeToString(xmlDoc);
};
