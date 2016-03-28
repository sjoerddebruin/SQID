
angular.module('utilities', [])
.factory('jsonData', function() {

	var JSON_LABEL = "l";
	var JSON_INSTANCES = "i";
	var JSON_SUBCLASSES = "s";
	var JSON_RELATED_PROPERTIES = "r";

	return {
		JSON_LABEL: JSON_LABEL,
		JSON_INSTANCES: JSON_INSTANCES,
		JSON_SUBCLASSES: JSON_SUBCLASSES,
		JSON_RELATED_PROPERTIES: JSON_RELATED_PROPERTIES,

		JSON_ITEMS_WITH_SUCH_STATEMENTS: "i",
		JSON_USES_IN_STATEMENTS: "s",
		JSON_USES_IN_STATEMENTS_WITH_QUALIFIERS: "w",
		JSON_USES_IN_QUALIFIERS: "q",
		JSON_USES_IN_PROPERTIES: "p",
		JSON_USES_IN_REFERENCES: "e",
		JSON_DATATYPE: "d",

		TABLE_SIZE: 15,
		PAGE_SELECTOR_SIZE: 2
	};

})

.factory('i18n', function(wikidataapi, Properties) {
	var language = 'en';

	var idTerms = {}; // cache for labels/descriptions of items
	var idTermsSize = 0; // current size of cache

	var propertyLabels = {}; // cache for labels of properties; may be unused for 'en'
	var properties = null; // properties data object (used for language en instead of fetching labels)

	var clearCache = function() {
		idTerms = {};
		idTermsSize = 0;
	}

	var setLanguage = function(newLang) {
		if (language != newLang) {
			language = newLang;
			clearCache(); // clear term cache that was based on old language
		}
	}

	// Clear term cache when it grows too big to prevent memory leak.
	// This should only be called at the beginning of a new page display to ensure that
	// we don't delete cache entries that some callers require.
	var checkCacheSize = function() {
		if (idTermsSize > 5000) {
			// 5000 is a lot; only the hugest of items may reach that (which is no problem either)
			clearCache();
		}
	}

	var hasCachedEntityTerms =  function(entityId) {
		return (entityId in idTerms);
	}

	var getCachedEntityTerms = function(entityId) {
		if (hasCachedEntityTerms(entityId)) {
			return idTerms[entityId];
		} else {
			return { label: entityId, description: ''};
		}
	}

	var hasPropertyLabel = function(propertyId) {
		if (language == 'en') {
			return properties !== null;
		} else {
			return (propertyId in propertyLabels);
		}
	}

	var getPropertyLabel = function(propertyId) {
		if (hasPropertyLabel(propertyId)) {
			if (language == 'en') {
				var numId = propertyId.substring(1);
				return properties.getLabelOrId(numId);
			} else {
				return propertyLabels[propertyId];
			}
		} else {
			return propertyId;
		}
	}

	var waitForTerms = function(entities) {
		var missingEntities = [];
		for (var i=0; i < entities.length; i++) {
			if (!hasCachedEntityTerms(entities[i])) {
				missingEntities.push(entities[i]);
			}
		}
		return wikidataapi.getEntityTerms(missingEntities, language).then(function(entityTerms) {
			angular.extend(idTerms, entityTerms);
			idTermsSize = Object.keys(idTerms).length;
			return true;
		});
	}

	var waitForPropertyLabels = function(propertyIds) {
		if (language == 'en') {
			return Properties.then(function(props) {
				properties = props;
				return true;
			});
		} else {
			var missingPropertyIds = [];
			for (var i=0; i < propertyIds.length; i++) {
				if (!(propertyIds[i] in propertyLabels)) {
					missingPropertyIds.push(propertyIds[i]);
				}
			}
			return wikidataapi.getEntityLabels(missingPropertyIds, language).then(function(entityLabels) {
				angular.extend(propertyLabels, entityLabels);
				return true;
			});
		}
	}

	var getEntityUrl = function(entityId) {
		return "#/view?id=" + entityId + ( language != 'en' ? '&lang=' + language : '');
	}

	var autoLinkText = function(text) {
		return text.replace(/[QP][1-9][0-9]*/g, function(match) { return '<a href="' + getEntityUrl(match) +'">' + match + '</a>'; });
	}

	var getPropertyLink = function(propertyId) {
		return '<a href="' + getEntityUrl(propertyId) + '">' + getPropertyLabel(propertyId) + '</a>';
	}

	return {
		getLanguage: function() { return language; },
		setLanguage: setLanguage,
		getEntityUrl: getEntityUrl,
		autoLinkText: autoLinkText,
		getPropertyLabel: getPropertyLabel,
		getPropertyLink: getPropertyLink,
		checkCacheSize: checkCacheSize,
		getCachedEntityTerms: getCachedEntityTerms,
		hasCachedEntityTerms: hasCachedEntityTerms,
		waitForTerms: waitForTerms,
		waitForPropertyLabels: waitForPropertyLabels
	};
})

.factory('util', function($http, $q) {

	var httpRequest = function(url) {
		return $http.get(url).then(function(response) {
			if (typeof response.data === 'object') {
				return response.data;
			} else {
				// invalid response
				return $q.reject(response.data);
			}
		},
		function(response) {
			// something went wrong
			return $q.reject(response.data);
		});
	}

	var jsonpRequest = function(url) {
		return $http.jsonp(url).then(function(response) {
			if (typeof response.data === 'object') {
				return response.data;
			} else {
				// invalid response
				return $q.reject(response.data);
			}
		},
		function(response) {
			// something went wrong
			return $q.reject(response.data);
		});
	}
	
	var getIdFromUri = function(uri) {
		if ( uri.substring(0, "http://www.wikidata.org/entity/".length) === "http://www.wikidata.org/entity/" ) {
			return uri.substring("http://www.wikidata.org/entity/".length, uri.length);
		} else {
			return null;
		}
	}

	var cloneObject = function(obj) {
	    if (obj === null || typeof obj !== 'object') {
	        return obj;
	    }
	 
	    var temp = obj.constructor(); // give temp the original obj's constructor
	    for (var key in obj) {
	        temp[key] = cloneObject(obj[key]);
	    }
	 
	    return temp;
	};

	var sortByCount = function(objectList) {
		objectList.sort(function(a, b) {
			return a.count < b.count ? 1 : (a.count > b.count ? -1 : 0);
		});
	}

	return {
		httpRequest: httpRequest,
		jsonpRequest: jsonpRequest,
		getIdFromUri: getIdFromUri,
		cloneObject: cloneObject,
		sortByCount: sortByCount
	};

})

.factory('sparql', function(util, i18n) {

	var SPARQL_SERVICE = "https://query.wikidata.org/bigdata/namespace/wdq/sparql";
	var SPARQL_UI_PREFIX = "https://query.wikidata.org/#";

	var getQueryUrl = function(sparqlQuery) {
		return SPARQL_SERVICE + "?query=" + encodeURIComponent(sparqlQuery);
	}

	var getQueryUiUrl = function(sparqlQuery) {
		return SPARQL_UI_PREFIX + encodeURIComponent(sparqlQuery);
	}

	var getQueryForPropertySubjects = function(propertyId, objectId, limit) {
		return "PREFIX wikibase: <http://wikiba.se/ontology#> \n\
PREFIX wdt: <http://www.wikidata.org/prop/direct/> \n\
PREFIX wd: <http://www.wikidata.org/entity/> \n\
SELECT $p $pLabel \n\
WHERE { \n\
   { SELECT DISTINCT $p WHERE { $p wdt:" + propertyId +  (objectId != null ? " wd:" + objectId : " _:bnode")  +
   " . } LIMIT " + limit + " } \n\
   SERVICE wikibase:label { bd:serviceParam wikibase:language \"" + i18n.getLanguage() + "\" . } \n\
}";
	}

	var getQueryForPropertyObjects = function(subjectId, propertyId, limit) {
		return "PREFIX wikibase: <http://wikiba.se/ontology#> \n\
PREFIX wdt: <http://www.wikidata.org/prop/direct/> \n\
PREFIX wd: <http://www.wikidata.org/entity/> \n\
SELECT $p $pLabel \n\
WHERE { \n\
   { SELECT DISTINCT $p WHERE { " + (subjectId != null ? "wd:" + subjectId : "_:bnode") +
   " wdt:" + propertyId + " ?p . \n\
     FILTER(isIRI(?p)) } LIMIT " + limit + " } \n\
   SERVICE wikibase:label { bd:serviceParam wikibase:language \"" + i18n.getLanguage() + "\" . } \n\
}";
	}

	var fetchPropertySubjects = function(propertyId, objectId, limit) {
		var url = getQueryUrl(getQueryForPropertySubjects(propertyId, objectId, limit));
		return util.httpRequest(url);
	}

	var fetchPropertyObjects = function(subjectId, propertyId, limit) {
		var url = getQueryUrl(getQueryForPropertyObjects(subjectId, propertyId, limit));
		return util.httpRequest(url);
	}

	var getInlinkCount = function(propertyID, objectItemId) {
		var query = "PREFIX wdt: <http://www.wikidata.org/prop/direct/> \n\
PREFIX wd: <http://www.wikidata.org/entity/> \n\
SELECT (count(*) as $c) WHERE { $p wdt:" + propertyID + " wd:" + objectItemId + " . }";
		var result = JSON.parse(httpGet(getQueryUrl(query)));
		return result.results.bindings[0].c.value;
	}

	var parseUnarySparqlQueryResult = function(data, limit, continueUrl) {
		results = [];
		try {
			var instanceJson = data.results.bindings;
			var element;
			for (var i = 0; i < instanceJson.length; i++) {
				if ( i < limit-1 ) {
					var uri = i18n.getEntityUrl(util.getIdFromUri(instanceJson[i].p.value));
					element = {
						label: instanceJson[i].pLabel.value,
						uri: uri
					};
				} else {
					element = {
						label: "... further results",
						uri: getQueryUiUrl(continueUrl)
					};
				}
				results.push(element);
			}
		}
		catch (err) {
			//nothing to do here
		}
		return results;
	}

	var getPropertySubjects = function(propertyId, objectId, limit) {
		return fetchPropertySubjects(propertyId, objectId, limit).then(function(data){
			return parseUnarySparqlQueryResult(data, limit, getQueryForPropertySubjects(propertyId, objectId, 1000));
		});
	}

	var getPropertyObjects = function(subjectId, propertyId, limit) {
		return fetchPropertyObjects(subjectId, propertyId, limit).then(function(data){
			return parseUnarySparqlQueryResult(data, limit, getQueryForPropertyObjects(subjectId, propertyId, 1000));
		});
	}

	return {
		getQueryUrl: getQueryUrl,
		getQueryUiUrl: getQueryUiUrl,
		getInlinkCount: getInlinkCount,
		getPropertySubjects: getPropertySubjects,
		getPropertyObjects: getPropertyObjects,
		getIdFromUri: util.getIdFromUri // deprecated; only for b/c
	};

})

.factory('wikidataapi', function(util, $q) {

	var getEntityData = function(id, language) {
		// Special:EntityData does not always return current data, not even with "action=purge"
		return util.jsonpRequest('https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&ids=' + id + '&redirects=yes&props=sitelinks|descriptions|claims|datatype|aliases|labels&languages=' + language + '&callback=JSON_CALLBACK');
	}

	var getEntityTerms = function(entityIds, language) {
		var baseUrl = 'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&redirects=yes&props=descriptions%7Clabels&languages=' + language + '&callback=JSON_CALLBACK';
		var requests = [];

		for (var i = 0; i < entityIds.length; i += 50) {
			requests.push(util.jsonpRequest(baseUrl + '&ids=' + entityIds.slice(i,i+50).join('|')));
		}

		return $q.all(requests).then( function(responses) {
			var idTerms = {}
			angular.forEach(responses, function(response) {
				if ("entities" in response) {
					angular.forEach(response.entities, function(data,entityId) {
						var label = entityId;
						var desc = "";
						if (language in data.labels) label = data.labels[language].value;
						if (language in data.descriptions) desc = data.descriptions[language].value;
						idTerms[entityId] = { label: label, description: desc };
					});
				}
			});
			return idTerms;
		});
	};

	var getEntityLabels = function(entityIds, language) {
		var baseUrl = 'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&redirects=yes&props=labels&languages=' + language + '&callback=JSON_CALLBACK';
		var requests = [];

		for (var i = 0; i < entityIds.length; i += 50) {
			requests.push(util.jsonpRequest(baseUrl + '&ids=' + entityIds.slice(i,i+50).join('|')));
		}

		return $q.all(requests).then( function(responses) {
			var entityLabels = {}
			angular.forEach(responses, function(response) {
				if ("entities" in response) {
					angular.forEach(response.entities, function(data,entityId) {
						if (language in data.labels) { 
							entityLabels[entityId] = data.labels[language].value;
						} else {
							entityLabels[entityId] = entityId;
						}
					});
				}
			});
			return entityLabels;
		});
	};

	var getImageData = function(fileName, width) {
		var url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&titles=File%3A' +
			encodeURIComponent(fileName) + '&iiprop=size%7Curl&iiurlwidth=' + width + '&callback=JSON_CALLBACK';
		return util.jsonpRequest(url).then(function(response) {
			for (var key in response.query.pages) { // return first result
				return response.query.pages[key].imageinfo[0];
			}
		});
	};

	return {
		getEntityData: getEntityData,
		getEntityTerms: getEntityTerms,
		getEntityLabels: getEntityLabels,
		getImageData: getImageData
	};
})

.factory('entitydata', function(wikidataapi, util, i18n) {

	var getStatementValue = function(statementJson, defaultValue) {
		try {
			var ret = statementJson.mainsnak.datavalue.value;
			if (ret) return ret;
		} catch (err) {
			// fall through
		}
		return defaultValue;
	}

	var addEntityIdsFromSnak = function(snak, missingIds) {
		if (snak.snaktype == 'value') {
			switch (snak.datavalue.type) {
				case 'wikibase-entityid':
					if (snak.datavalue.value["entity-type"] == "item") {
						missingIds["Q" + snak.datavalue.value["numeric-id"]] = true;
					}
					break;
				case 'quantity':
					var unit = util.getIdFromUri(snak.datavalue.value.unit);
					if (unit !== null) {
						missingIds[unit] = true;
					}
					break;
				case 'globecoordinate':
					var globe = util.getIdFromUri(snak.datavalue.value.globe);
					if (globe !== null) {
						missingIds[globe] = true;
					}
					break;
				case 'time':
				case 'string':
				case 'monolingualtext':
				default:
					break; // no ids
			}
		}
	}

	var getEntityIds = function(statements) {
		var result = {};
		angular.forEach(statements, function(statementGroup) {
			angular.forEach(statementGroup, function (statement) {
				addEntityIdsFromSnak(statement.mainsnak, result);
				if ('qualifiers' in statement) {
					angular.forEach(statement.qualifiers, function (snakList) {
						angular.forEach(snakList, function(snak) {
							addEntityIdsFromSnak(snak, result);
						});
					});
				}
			});
		});
		return Object.keys(result);
	}

	var addPropertyIdsFromSnak = function(snak, missingIds) {
		if ( snak.snaktype == 'value'
			&& snak.datavalue.type == 'wikibase-entityid'
			&& snak.datavalue.value["entity-type"] == "property" ) {
				missingIds["P" + snak.datavalue.value["numeric-id"]] = true;
		}
		missingIds[snak.property] = true;
	}

	var getPropertyIds = function(statements) {
		var result = {};
		angular.forEach(statements, function(statementGroup) {
			angular.forEach(statementGroup, function (statement) {
				addPropertyIdsFromSnak(statement.mainsnak, result);
				if ('qualifiers' in statement) {
					angular.forEach(statement.qualifiers, function (snakList) {
						angular.forEach(snakList, function(snak) {
							addPropertyIdsFromSnak(snak, result);
						});
					});
				}
			});
		});
		return Object.keys(result);
	}

	var getEntityData = function(id) {
		var language = i18n.getLanguage();
		return wikidataapi.getEntityData(id, language).then(function(response) {
			var ret = {
				language: language, // this is fixed for this result!
				label: "",
				labelorid: id,
				description: "",
				images: [],
				aliases: [],
				banner: null,
				superclasses: [],
				instanceClasses: [],
				superProperties: [],
				statements: {},
				missing: false,
				termsPromise: null,
				propLabelPromise: null,
				waitForPropertyLabels: function() {
					if (this.propLabelPromise == null) {
						var propIdList = getPropertyIds(this.statements);
						this.propLabelPromise = i18n.waitForPropertyLabels(propIdList, language);
					}
					return this.propLabelPromise;
				},
				waitForTerms: function() {
					if (this.termsPromise == null) {
						var termIdList = getEntityIds(this.statements);
						this.termsPromise = i18n.waitForTerms(termIdList, language);
					}
					return this.termsPromise;
				}
			};

			if ("error" in response || "missing" in response.entities[id]) {
				ret.missing = true;
				return ret;
			}

			var entityData = response.entities[id];

			if ("labels" in entityData && ret.language in entityData.labels) {
				ret.label = entityData.labels[ret.language].value;
				ret.labelorid = entityData.labels[ret.language].value;
			}
			if ("descriptions" in entityData && ret.language in entityData.descriptions) {
				ret.description = entityData.descriptions[ret.language].value;
			}
			if ("aliases" in entityData && ret.language in entityData.aliases) {
				var aliasesData = entityData.aliases[ret.language];
				for (var i in aliasesData){
					ret.aliases.push(aliasesData[i].value);
				}
			}
			
			if ("claims" in entityData) {
				// image
				if ("P18" in entityData.claims) {
					for (var i in entityData.claims.P18) {
						var imageFileName = getStatementValue(entityData.claims.P18[i],"");
						ret.images.push(imageFileName.replace(" ","_"));
					}
				}
				// instance of
				if ("P31" in entityData.claims) {
					for (var i in entityData.claims.P31) {
						ret.instanceClasses.push(getStatementValue(entityData.claims.P31[i],{"numeric-id": 0})["numeric-id"].toString());
					}
				}
				// subclass of
				if ("P279" in entityData.claims) {
					for (var i in entityData.claims.P279) {
						ret.superclasses.push(getStatementValue(entityData.claims.P279[i],{"numeric-id": 0})["numeric-id"].toString());
					}
				}
				// subproperty of
				if ("P1647" in entityData.claims) {
					for (var i in entityData.claims.P1647) {
						ret.superProperties.push(getStatementValue(entityData.claims.P1647[i],{"numeric-id": 0})["numeric-id"].toString());
					}
				}
				// Wikivoyage banner; only pick the first banner if multiple
				if ("P948" in entityData.claims) {
					var imageFileName = getStatementValue(entityData.claims.P948[0],"");
					ret.banner = imageFileName.replace(" ","_");
				}
				
				ret.statements = entityData.claims;
			}

			return ret;
		});
	};
	
	return {
		getEntityData: getEntityData
	};
})

.directive('wdcbImage', function(wikidataapi) {

	var link = function (scope, element, attrs) {
		scope.$watch(attrs.file, function(file){
			wikidataapi.getImageData(file,attrs.width).then(function(imagedata) {
				var html = '<a href="' + imagedata.descriptionurl + '" taget="_blank">' +
						'<img src="' + imagedata.thumburl +'" style="display: block; margin-left: auto; margin-right: auto;"/>' +
					'</a>';
				element.replaceWith(html);
			});
		});
	};
	
	return {
		restrict: 'E',
		link: link
	};
})

.directive('wdcbFooter', function(statistics) {

	var link = function (scope, element, attrs) {
		statistics.then(function(stats) {
			var innerHtml = '<div class="col-md-6">Statistics based on data dump ' + stats.getDumpDateString() + '</div>';
			innerHtml += '<div class="col-md-6">Powered by \
				<a href="https://github.com/Wikidata/Wikidata-Toolkit">Wikidata Toolkit</a> &amp; \
				<a href="https://query.wikidata.org/">Wikidata SPARQL Query</a></div>';
			element.replaceWith('<hr/><div class="container-fluid"><div class="footer row">' + innerHtml + '</div></div>');
		});
	};
	
	return {
		restrict: 'E',
		link: link
	};
})

.directive('wdcbStatementTable', function(Properties, Classes, wikidataapi, util, i18n) {
	var properties = null;

	var link = function (scope, element, attrs) {
		var show = attrs.show;
		var title = attrs.title;

		var hasMissingTerms = false;

		var includeProperty = function(numId) {
			if (!show || show == 'all') {
				return true;
			}
			if (numId == '31' || numId == '279') {
				return false;
			}

			var isId = (properties.getDatatype(numId) == 'ExternalId');
			var isHumanRelation = false;
			var isMedia = (properties.getDatatype(numId) == 'CommonsMedia');
			var isAboutWikiPages = (numId == '1151') || // "topic's main Wikimedia portal"
									(numId == '910'); // "topic's main category"
			angular.forEach(properties.getClasses(numId), function(classId) {
				if (classId == '19847637' || // "Wikidata property representing a unique identifier"
					classId == '18614948' || // "Wikidata property for authority control"
					classId == '19595382' || // "Wikidata property for authority control for people"
					classId == '19829908' || // "Wikidata property for authority control for places"
					classId == '19833377' || // "Wikidata property for authority control for works"
					classId == '18618628' || // "Wikidata property for authority control for cultural heritage identification"
					classId == '21745557' || // "Wikidata property for authority control for organisations"
					classId == '19833835' || // "Wikidata property for authority control for substances"
					classId == '22964274'  // "Wikidata property for identication in the film industry"
				) {
					isId = true;
				} else if (classId == '22964231') { // "Wikidata property for human relationships"
					isHumanRelation = true;
				} else if (classId == '18610173') { // "Wikidata property for Commons"
					isMedia = true;
				} else if (classId == '18667213') { // "Wikidata property about Wikimedia categories"
					isAboutWikiPages = true;
				}
			});

			switch (show) {
				case 'ids':
					return isId;
				case 'family':
					return isHumanRelation;
				case 'media':
					return isMedia;
				case 'wiki':
					return isAboutWikiPages;
				case 'other': default:
					return !isId && !isHumanRelation && !isMedia && !isAboutWikiPages;
			}
		}

		var getEntityTerms = function(entityId) {
			if (!i18n.hasCachedEntityTerms(entityId)) {
				hasMissingTerms = true;
			}
			return i18n.getCachedEntityTerms(entityId);
		}

		var getValueHtml = function(datavalue, numPropId) {
			switch (datavalue.type) {
				case 'wikibase-entityid':
					if (datavalue.value["entity-type"] == "item") {
						var itemId = "Q" + datavalue.value["numeric-id"];
						var terms = getEntityTerms(itemId);
						return '<a href="' + i18n.getEntityUrl(itemId) + '">' + terms.label + '</a>' +
							( terms.description != '' ? ' <span class="smallnote">(' + i18n.autoLinkText(terms.description) + ')</span>' : '' );
					} else if (datavalue.value["entity-type"] == "property") {
						return i18n.getPropertyLink('P' + datavalue.value["numeric-id"]);
					}
				case 'time':
					var dateParts = datavalue.value.time.split(/[-T]/);
					var precision = datavalue.value.precision;
					var epochModifier = '';
					if (dateParts[0] == '') {
						dateParts.shift();
						epochModifier = ' BCE';
					} else if (dateParts[0].substring(0,1) == '+' ) {
						dateParts[0] = dateParts[0].substring(1);
					}
					var result = dateParts[0];
					if (precision >= 10) {
						result += '-' + dateParts[1];
					}
					if (precision >= 11) {
						result += '-' + dateParts[2];
					}
					if (precision >= 12) {
						result += ' ' + dateParts[3];
					}
					return result + epochModifier;
				case 'string':
					switch (properties.getDatatype(numPropId)) {
						case 'Url':
							return '<a class="ext-link" href="' + datavalue.value + '" target="_blank">' + datavalue.value + '</a>';
						case 'CommonsMedia':
							return '<a class="ext-link" href="https://commons.wikimedia.org/wiki/File:' + datavalue.value.replace(' ','_') + '" target="_blank">' + datavalue.value + '</a>';
						//case 'String':
						default:
							var urlPattern = properties.getUrlPattern(numPropId);
							if (urlPattern) {
								return '<a class="ext-link" href="' + urlPattern.replace('$1',datavalue.value) + '" target="_blank">' + datavalue.value + '</a>';
							} else {
								return datavalue.value;
							}
					}
				case 'monolingualtext':
					return i18n.autoLinkText(datavalue.value.text) + ' <span class="smallnote">[' + datavalue.value.language + ']</span>';
				case 'quantity':
					var amount = datavalue.value.amount;
					if (amount.substring(0,1) == '+') {
						amount = amount.substring(1);
					}
					var unit = util.getIdFromUri(datavalue.value.unit);
					if (unit !== null) {
						unit = ' <a href="' + i18n.getEntityUrl(unit) + '">' + getEntityTerms(unit).label + '</a>';
					} else {
						unit = '';
					}
					return amount + unit;
				case 'globecoordinate':
					var globe = util.getIdFromUri(datavalue.value.globe);
					if (globe !== null && globe != 'Q2') {
						globe = ' on <a href="' + i18n.getEntityUrl(globe) + '">' + getEntityTerms(globe).label + '</a>';
					} else {
						globe = '';
					}
					return '(' + datavalue.value.latitude + ', ' + datavalue.value.longitude + ')' + globe;
				default:
					return 'value type "' + datavalue.type + '" is not supported yet.';
			}
		}

		var makeSnakHtml = function(snak, showProperty) {
			ret = '';
			var propId = snak.property;
			if (showProperty) {
				ret += i18n.getPropertyLink(propId) + ' : ';
			}
			switch (snak.snaktype) {
				case 'value': 
					ret += getValueHtml(snak.datavalue, propId.substring(1));
					break;
				case 'somevalue':
					ret += '<i>unspecified value</i>';
					break;
				case 'novalue':
					ret += '<i>no value</i>';
					break;
			}
			return ret;
		}
		
		var makeStatementValueHtml = function(statement) {
			ret = makeSnakHtml(statement.mainsnak, false);
			if (statement.rank == 'preferred') {
				ret += ' <span class="glyphicon glyphicon-star" aria-hidden="true" title="This is a preferred statement"></span>';
			} else if (statement.rank == 'deprecated') {
				ret = '<span style="text-decoration: line-through;">' + ret + '</span> <span class="glyphicon glyphicon-ban-circle" aria-hidden="true" title="This is a deprecated statement"></span>';
			} 
			
			if ('qualifiers' in statement) {
				ret += '<div style="padding-left: 10px; font-size: 80%; ">';
				angular.forEach(statement.qualifiers, function (snakList) {
					angular.forEach(snakList, function(snak) {
						ret += '<div>' + makeSnakHtml(snak, true) + '</div>';
					});
				});
				ret += '</div>';
			}
			return ret;
		};

		var getHtml = function(statements, propertyList) {
			hasMissingTerms = false;
			var panelId = 'statements_' + show;
			var html = '<div class="panel panel-info">\n' +
						'<div class="panel-heading"><h2 class="panel-title">\n' +
						'<a data-toggle="collapse" data-target="#' + panelId + '"  style="cursor:pointer;cursor:hand">' + title + '</a></h2></div>' +
						'<div id="' + panelId + '" class="panel-collapse collapse in">' +
						'<div style="overflow: auto;"><table class="table table-striped table-condensed"><tbody>';
			var hasContent = false;
			angular.forEach(propertyList, function (propId) {
				var statementGroup = statements[propId]
				if (!hasMissingTerms) {
					angular.forEach(statementGroup, function (statement, index) {
						hasContent = true;
						html += '<tr>';
						if (index == 0) {
							html += '<th valign="top" rowspan="' + statementGroup.length + '" style="min-width: 20%;">'
								+ i18n.getPropertyLink(propId)
								+ '</th>';
						}
						html += '<td>' + makeStatementValueHtml(statement) + '</td>'
						html += '</tr>';
					});
				}
			});
			if (!hasContent) return '';

			html += '</tbody></table></div></div></div>';
			return html;
		}

		var preparePropertyList = function(itemData) {
			propertyScores = {};
			// Note: class-based ranking rarely seems to help; hence using properties only
			for (propertyId in itemData.statements) {
				angular.forEach(properties.getRelatedProperties(propertyId), function(relPropScore, relPropId) {
					if (relPropId in propertyScores) {
						propertyScores[relPropId] = propertyScores[relPropId] + relPropScore;
					} else {
						propertyScores[relPropId] = relPropScore;
					}
				});
			}

			scoredProperties = [];

			for (propertyId in itemData.statements) {
				var numPropId = propertyId.substring(1);
				if (includeProperty(numPropId)) {
					if (numPropId in propertyScores) {
						scoredProperties.push([numPropId,propertyScores[numPropId]]);
					} else {
						scoredProperties.push([numPropId,0]);
					}
				}
			}

			scoredProperties.sort(function(a, b) {
				var a = a[1];
				var b = b[1];
				return a < b ? 1 : (a > b ? -1 : 0);
			});

			ret = [];
			angular.forEach(scoredProperties, function(propertyData) {
				ret.push('P' + propertyData[0]);
			});
			return ret;
		}

		scope.$watch(attrs.data, function(itemData){
			itemData.waitForPropertyLabels().then(function() {
				Properties.then(function(propertyData){
					properties = propertyData;
					var propertyList = preparePropertyList(itemData);

					var html = getHtml(itemData.statements, propertyList);
					if (hasMissingTerms) {
						itemData.waitForTerms().then( function() {
							element.replaceWith(getHtml(itemData.statements, propertyList));
						});
					} else {
						element.replaceWith(html);
					}
				})
			});
		});
	};

	return {
		restrict: 'E',
		link: link
	};
});

