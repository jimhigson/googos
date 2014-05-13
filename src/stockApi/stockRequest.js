var request = require('request'),
    handlebars = require('handlebars'),
    fs = require('fs'),
    parseStockApiResponse = require('./parseStockApiResponse.js'),
    requestXmlBodyTemplate = handlebars.compile( fs.readFileSync('src/stockApi/requestTemplate.handlebars', 'utf-8')),
    API_KEY = 'uk4tbngzceyxpwwvfcbtkvkj';

function requestXmlBody(partNumbers, storeNumber) {
   return requestXmlBodyTemplate({
      storeNumber: storeNumber,
      partNumbers: partNumbers
   });
}

function makeXMLRequestBody(partNumbers, storeNumber, callback) {

   request({
      url: 'https://api.homeretailgroup.com/stock/argos?apiKey=' + API_KEY,
      method: 'POST',
      body: requestXmlBody(partNumbers, storeNumber)
   }, function(error, response) {
      callback(response.body);
   });
}

module.exports = function getStockInfoMiddleware(req, res) {

   var partNumbers = req.query.partNumbers.split(','),
       storeNumber = req.query.storeNumber;

   makeXMLRequestBody(partNumbers, storeNumber, function( xml ) {

      parseStockApiResponse(xml, function(err, stockJson) {

         res.setHeader('Content-Type', 'application/json');
         res.send(stockJson);
      });
   });
};