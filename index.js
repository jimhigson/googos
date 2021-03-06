var PORT = 6677,
    ELASTIC_SEARCH_HOST = 'http://beta.vichub.co.uk:9200/argos',
    //ELASTIC_SEARCH_HOST = 'http://localhost:9200/argos',

    express = require('express'),
    request = require('request'),
    oboe = require('oboe'),
    consolidate = require('consolidate'),
    parseXmlStringToJs = require('xml2js').parseString,
    handlebars = require('handlebars'),
   
    parsePriceRange = require('./parsePriceRange.js'),
    elasticSearchRequestBody = require('./elasticSearchRequestBody.js'),
    likelySameNoun = require('./likelySameNoun.js'),
    getStockInfo = require('./src/stockApi/stockApiRequestAggregator.js'),
   
    cmdLineParams = require('minimist')(process.argv.slice(2)),
    isProd = (cmdLineParams.env == 'prod'),

    SCRIPTS = isProd? ['/js-concat/all.js'] : require('./jsSourcesList.js'),
    STYLESHEETS = isProd? ["/css-min/all.css"] : ["/css/reset.css", "/css/style.css"],

    app = express();

require('colors');

function renderPage(res, term) {

   
   res.render('page', {
      startTerm:(term || ''),
      scripts:SCRIPTS,
      stylesheets:STYLESHEETS
   });
}

function unencodeTerm(raw) {
   if( !raw ) {
      return raw;
   } else {
      return raw.replace(/_/g, ' ');
   }
}

app.engine('handlebars', consolidate.handlebars);
app.set('view engine', 'handlebars');
app.set('views', __dirname + '/views');

app
   .get('/', function(req, res) {
      // legacy URL (already given to some people) - redirect / to /search
      res.redirect('/search');
   })
   .get('/search', function(req, res) {
      renderPage(res);
   })   
   .get('/search/:term',            servePageOrJson )
   .get('/search/:category/:term',  servePageOrJson )
   .get('/stores/:term', serveStoreJson)
   .get('/stockInfo/', getStockInfoMiddleware)
   .get('/makeReservation/:productNumber', makeReservation )
   .get('/makeReservationStub/:productNumber', makeReservationStub )
   .use(express.static('statics'));

app.listen(PORT);
console.log('server started'.green, 'in', (isProd? 'production':'dev').green, 'mode');

function getStockInfoMiddleware(req, res) {
   var partNumbers = req.query.partNumbers.split(','),
      storeNumber = req.query.storeNumber;

   res.setHeader('Content-Type', 'application/json');

   getStockInfo.request(partNumbers, storeNumber, function( result ) {
      res.send(result);
   });
}

function serveStoreJson(req, res) {
   
   var term = req.params.term;

   request({

      url: ELASTIC_SEARCH_HOST + '/stores/_search?q=' + term + '*'

   }, function (error, _, responseBodyJson) {

      var responseObj = JSON.parse(responseBodyJson);

      res.setHeader('Content-Type', 'application/json');

      if( !responseObj.error ) {
         res.send(responseObj);
      } else {
         res.send(responseObj.status, responseObj);
      }
   });   
}

function servePageOrJson(req, res) {

   var term     = unencodeTerm(req.params.term),
       category = unencodeTerm(req.params.category);
   
   console.log(
      'Searching for',
      ("'" + term + "'").blue,
      'in category',
      ("'" + category + "'").blue
   );

   if( req.query.json == 'true' ) {
      sendResultsJsonToClient(req, res, term, category);
   } else {
      renderPage(res, term, category);
   }
}

function sendResultsJsonToClient(req, res, query, category) {

   var queryTerms = parsePriceRange(query),
       requestBody = elasticSearchRequestBody(
                         queryTerms.term,
                         queryTerms.minPrice,
                         queryTerms.maxPrice,
                         category );
   
   res.setHeader('Content-Type', 'application/json');

   var searchResults = [],
       relatedTerms = [];
  
   oboe({
      url: ELASTIC_SEARCH_HOST + '/products/_search',
      method:'POST',
      body: JSON.stringify(requestBody)

   }).node('!error', function(error) {
      res.send('400', error);
      
   }).node('!hits..{price productTitle}', function( result ) {

      searchResults.push( prepareSearchResultForFrontEnd( result ) );

   }).node('!aggregations..{key doc_count}', function( aggregationResult, path ) {
      
      relatedTerms.push({
         key:aggregationResult.key,
         doc_count: aggregationResult.doc_count,
         source:path[1]
      });
      
   }).done(function(o) {
      
      var responseObject = {
         results : searchResults,
         relatedTerms: postProcessRelatedTerms(queryTerms.term, relatedTerms)
      };
      
      res.send(200, responseObject);
   }).fail(function(e) {
      res.send(400, 'there was a failure');
      console.log('there was a failure'.red, e);
   });
}

function postProcessRelatedTerms( query, terms ) {
   
   var differentFromQuery = terms.filter(function(term) {
      return !likelySameNoun(query, term.key);
   });
   
   var unduplicated = [];

   differentFromQuery.forEach(function(term) {
      var isDuplicate = unduplicated
                           .some(   function( existingTerm ){
                                       return likelySameNoun(existingTerm.key, term.key);
                                    });
      
      if(!isDuplicate) {
         unduplicated.push(term);
      }
   });
   
   var sorted = unduplicated.sort(function(a,b){
      return b.doc_count - a.doc_count;
   }); 
   
   return sorted;
}

function highlightedProductTitle(elasticSearchHit) {
   return (elasticSearchHit.highlight && elasticSearchHit.highlight.productTitle) || elasticSearchHit.productTitle
}

function prepareSearchResultForFrontEnd( elasticSearchHit ) {
   

   elasticSearchHit.highlightedProductTitle = highlightedProductTitle( elasticSearchHit );
   elasticSearchHit.formattedPrice = '£' + Number(elasticSearchHit.price).toFixed(2);
   
   return elasticSearchHit;
}

function makeReservation( req, res ) {

  // Grab reservation in from url
  var reservationData = {
    storeNumber: req.query.storeId,
    productNumber: req.params.productNumber,
    customerEmail: 'example@example.com',
    qtyRequired: '1',
    mobileNo: '07777777777'
  };

  // Create reservation string
  var reservationRequestTemplate = 'locationNumber={{storeNumber}}@51.49487,-0.14196&productNumber={{productNumber}}&customerEmail={{customerEmail}}&qtyRequired={{qtyRequired}}&hrgOptIn=false&thirdPartyOptIn=false&customerPhone=&contactNo=&mobileNo=';

  var template = handlebars.compile(reservationRequestTemplate);

  reservationRequest = template(reservationData);

  console.log(reservationRequest);

  request({
    url: 'http://api.argos.co.uk/reservation/create?apiKey=uk4tbngzceyxpwwvfcbtkvkj',
    method: 'POST',
    body: reservationRequest,
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8'
    }
  }, function( err, response ) {

  // Turn response in to JSON :D
  parseXmlStringToJs(response.body, function( err, result) {
      res.setHeader('Content-Type', 'application/json');
      res.send(result);
    });
  });
}

function makeReservationStub( req, res ) {

   var response = {"reservations": 
      {"reservation": [
         {"csoReservation": ["false"], "storeNumber": ["440"], "reservationNumber": ["390756"], "latestInStoreCollectionDate": ["2014-05-10"], "emailSent": ["true"], "smsSent": ["false"], "reservationItems": [
            {"reservationItem": [
               {"productNumber": ["6501455"], "reqQty": ["1"], "reservationStatus": ["success"], "allocQty": ["1"]}
            ]}
      ]}
   ]}};

   res.setHeader('Content-Type', 'application/json');
   
   setTimeout(function() {
      res.send(JSON.stringify(response));
   }, 2000);
}
