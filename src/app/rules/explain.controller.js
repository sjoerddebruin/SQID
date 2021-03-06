define(['rules/rules.module',
		'i18n/i18n.service',
		'util/dataFormatter.service',
		'rules/ast.service',
		'rules/instantiator.service'
	   ],
function() {
	angular.module('rules').controller('ExplainController',
	['$scope', '$route', '$sce', '$translate', '$q',
	'i18n', 'dataFormatter', 'ast', 'instantiator',
	function($scope, $route, $sce, $translate, $q, i18n, dataFormatter, ast, instantiator) {
		function labelForLiteral(literal) {
			if (angular.isUndefined(literal)) {
				return $sce.trustAsHtml('(undefined value in labelForLiteral)');
			}

			var label = '';
			if (literal.startsWith('P')) {
				label = i18n.getPropertyLink(literal);
			} else if (literal.startsWith('Q')) {
				var terms = i18n.getEntityTerms(literal);
				label = ('<a href="' + i18n.getEntityUrl(literal) +
						 '">' + terms.label + '</a>');
				if (terms.description !== '') {
					label += (' <span class="smallnote">(' +
							  i18n.autoLinkText(terms.description) +
							  ')</span>');
				}
			}

			return $sce.trustAsHtml(label);
		}

		try {
			var inference = angular.fromJson(
				$route.current.params.inference
			);
			$scope.explanation = inference;
		} catch (e) {
			if (!(e instanceof SyntaxError)) {
				throw e;
			} else {
				$scope.explanation = 'error.';
				return;
			}
		}

		if (angular.isUndefined(inference)) {
			// something went wrong. do something clever;
			$scope.explanation = 'error.';
			return;
		}

		var literals = ast.literals(inference.rule).map(function(literal) {
			return literal.name;
		}).filter(function(literal) {
			return /^[PQ][1-9][0-9]*$/.test(literal);
		});
		var bounds = [];
		angular.forEach(inference.bindings, function(binding) {
			if (angular.isObject(binding)) {
				if ('id' in binding) {
					bounds.push(binding.id.split('$', 1)[0]);
				} else {
				}
			} else {
				bounds.push(binding.split('$', 1)[0]);
			}
		});

		var properties = literals.concat(bounds)
			.filter(function(literal) {
				return literal.startsWith('P');
			});
		var terms = literals.concat(bounds)
			.filter(function(literal) {
				return literal.startsWith('Q');
			});

		var promise = $q.all([i18n.waitForPropertyLabels(properties),
				i18n.waitForTerms(terms)
			   ]).then(function() {
				   var labels = {};
				   var bindings = {};
				   angular.forEach(literals, function(literal) {
					   labels[literal] = labelForLiteral(literal);
				   });
				   angular.forEach(inference.bindings, function(binding, variable) {
					   if (angular.isObject(binding)) {
						   if (('id' in binding) &&
							   (!('type' in binding) || (binding.type !== 'set-variable'))) {
							   bindings[variable] = labelForLiteral(binding.id);
						   } else if ('item' in binding) {
							   bindings[variable] = $sce.trustAsHtml(
								   binding.item.map(function(value) {
									   return dataFormatter.getSnakHtml(value);
								   }).join('<br>')
							   );
						   }
					   } else {
						   bindings[variable] = labelForLiteral(binding);
					   }
				   });

				   $scope.explanation.labels = labels;
				   $scope.explanation.bounds = bindings;
				   $scope.explanation.statement = {
					   statements: instantiator.instantiateRuleHead(inference, undefined, true),
					   waitForPropertyLabels: function() {
						   return promise;
					   },
					   waitForTerms: function() {
						   return promise;
					   }
				   };

				   var subject = inference.rule.head.arguments[0];
				   var item = inference.bindings[subject.name].id;
				   var term = i18n.getEntityTerms(item);
				   var label = ('<a href="' + i18n.getEntityUrl(item) +
								'">' + term.label + '</a>');
				   if (terms.description !== '') {
					   label += (' <span class="smallnote">(' +
								 i18n.autoLinkText(term.description) +
								 ')</span>');
				   }
				   $scope.explanation.title = label;
			   });
	}]);

	return {};
});
