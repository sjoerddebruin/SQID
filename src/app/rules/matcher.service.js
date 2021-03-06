define(['rules/rules.module',
		'util/util.service',
		'rules/ast.service',
		'rules/parser.service'
], function() {
	angular.module('rules').factory('matcher',
	['$log', 'util', 'ast', 'parser',
	function($log, util, ast, parser) {
		function hasMatchingStatement(statements, predicate, object) {
			var predicates = Object.keys(statements);

			if (predicate.type === 'literal') {
				predicates = [predicate.name];

				if (!(predicate.name in statements)) {
					return false;
				}
			}

			if ((!object) ||
				(object.type === 'variable')) {
				return true;
			}

			return predicates.some(function(pred) {
				return statements[pred].some(function(stmt) {
					return (((stmt.mainsnak.datavalue.type === 'value') &&
							 (stmt.mainsnak.datavalue.value === object.name)) ||
							((stmt.mainsnak.datavalue.type === 'wikibase-entityid') &&
							 ('id' in stmt.mainsnak.datavalue.value) &&
							 (stmt.mainsnak.datavalue.value.id === object.name)));
				});
			});
		}

		function copyQualifiers(qualifiers) {
			// FIXME filter out references here
			return qualifiers;
		}

		function couldMatch(data, inboundData, itemId) {
			return function(rule) {
				var subject = rule.head.arguments[0];

				if (subject.type === 'literal' &&
					subject.name != itemId) {
					return false;
				}

				return rule.body.every(function(atom) {
					if (atom.type !== 'relational-atom') {
						return true;
					}

					if ((atom.arguments[0].name === subject.name) &&
						(!hasMatchingStatement(data,
											   atom.predicate,
											   atom.arguments[1]))) {
						return false;
					}

					if ((atom.arguments[1].name === subject.name) &&
						(!hasMatchingStatement(inboundData,
											   atom.predicate))) {
						return false;
					}

					return true;
				});
			};
		}

		function getInstanceCandidatesQuery(rule, bindings, maxInstances) {
			if (angular.isUndefined(bindings)) {
				bindings = {};
			}

			if(!isNaN(maxInstances) && !isFinite(maxInstances) && (maxInstances > 0)) {
				maxInstances = Infinity;
			} else if(!isFinite(maxInstances) || maxInstances <= 0) {
				maxInstances = 101; // what is a sane default here?
			}

			var constraints = [];
			var sparqlBindings = [];
			var sparqlPatterns = [];
			var sparqlOptionals = [];
			var sparqlNotExists = [];

			angular.forEach(rule.body, function(atom, key) {
				var namespace = '?_body_' + key + '_';
				var fragment = sparqlFragmentForAtom(atom, bindings, namespace);
				sparqlBindings = sparqlBindings.concat(fragment.bindings);
				sparqlPatterns = sparqlPatterns.concat(fragment.patterns);
				sparqlOptionals = sparqlOptionals.concat(fragment.optionals);
				constraints = constraints.concat(fragment.constraints);
			});

			// if the head predicat's subject is unbound, add a
			// pattern to weed out matching heads
			if (false && // doesn't currently work correctly.
				(rule.head.arguments[0].type == 'variable') &&
				!(rule.head.arguments[0].name in bindings)) {
				var atom = rule.head;

				if (atom.annotation.type === 'variable') {
					// make sure we use a fresh name here
					atom.annotation.name = '?_head_filter_annotation';
				}

				var fragment = sparqlFragmentForAtom(
					rule.head,
					bindings,
					'?_head_filter_');

				sparqlNotExists = sparqlNotExists.concat(
					sparqlFragmentForAtom(
						rule.head,
						bindings,
						'?_head_filter_'
					).patterns
				);
			}

			var interestingVariables = [];

			angular.forEach(ast.variables(rule.head),
							function(variable) {
								if ((variable.type !== 'variable') ||
									(variable.name in bindings)) {
									return;
								}

								interestingVariables.push(variable.name);
							});

			if (constraints.length > 0) {
				constraints = util.unionArrays(constraints, []);
			}

			// TODO: handle dots
			angular.forEach(rule.head.annotation.assignments, function(assignment) {
				if (assignment.value.type === 'dot') {
					if (!(assignment.value.fromSpecifier.name in interestingVariables)) {
						interestingVariables.push(assignment.value.fromSpecifier.name);
					}

					sparqlOptionals.push('OPTIONAL { ' +
										 [
											 assignment.value.fromSpecifier.name,
											 'pq:' + assignment.value.item.name,
											 '[]'
										 ].join(' ') + ' }'
										);
				}
			});

			// ensure that set variables in the head are always interesting
			if ('name' in rule.head.annotation) {
				interestingVariables.push(rule.head.annotation.name);
			}

			sparqlBindings = util.unionArrays(sparqlBindings,
											  interestingVariables,
											  [rule.head.annotation.name]);

			var query = sparqlQueryFromFragments(sparqlBindings,
												 sparqlPatterns,
												 sparqlOptionals,
												 sparqlNotExists,
												 maxInstances);

			return { rule: rule,
					 query: query,
					 bindings: bindings,
					 constraints: constraints
				   };
		}

		function sparqlFragmentForAtom(atom, variableBindings, namespace) {
			var variables = 0;
			var bindings = [];
			var patterns = [];
			var optionals = [];
			var constraints = [];

			function addPattern(subject, predicate, object) {
				patterns.push([subject, predicate, object].join(' '));
			}

			function addConstraint(type) {
				var args = [];
				var length = arguments.length;

				// add remaining arguments (skip arguments[0], it is `type')
				for (var i = 1; i < length; ++i) {
					if (angular.isDefined(arguments[i])) {
						args.push(arguments[i]);
					}
				}

				constraints.push({ type: type,
								   args: args
								 });
			}

			function freshVar() {
				return namespace + (++variables);
			}

			function maybeBinding(name, prefix, handle, assignment) {
				if (!prefix) {
					prefix = '';
				} else if (prefix.slice !== ':') {
					prefix += ':';
				}

				if ('name' in name) {
					name = name.name;
				}

				if (name in variableBindings) {
					if (angular.isDefined(handle)) {
						variableBindings[name].fromSpecifier = handle;
					}

					return prefix + variableBindings[name].id;
				} else if (parser.isVariableName(name)) {
					if (angular.isDefined(handle)) {
						variableBindings[name] = {
							fromSpecifier: handle,
							item: assignment
						};
					}

					return name;
				}

				return prefix + name;
			}

			function bindingOrFreshVarWithEquality(set) {
				if (set.name in variableBindings) {
					if (variableBindings[set.name].used) {
						// we already have a binding for this set variable
						var variant = freshVar();
						addConstraint('Equality', set.name, variant);

						return variant;
					} else {
						// first use of this binding
						variableBindings[set.name].used = true;

						return set.name;
					}
				} else {
					// we have not encountered this set variable before,
					// just add a binding and carry on.
					variableBindings[set.name] = { name: set.name,
												   type: 'set-variable',
												   used: false
												 };

					return set.name;
				}
			}

			function isVar(name) {
			   return name.startsWith('?');
			}

			function patternsForSpecifier(atom, indent, handle) {
				if (!isFinite(indent)) {
					indent = 0;
				}

				var patterns = [];
				var optionals = [];

				function addPattern(subject, predicate, object) {
					patterns.push([subject, predicate, object].join(' '));
				}

				function addOptional(set, attribute, value) {
					optionals.push(' '.repeat(indent) + 'OPTIONAL { ' +
								   [set, attribute, value].join(' ') + ' }');
				}

				function addGroup(group, op, other) {
					var pattern = (' '.repeat(indent) + '{ ' +
								   group.join('\n' + ' '.repeat(indent + 2)) + ' }');

					if (angular.isDefined(op)) {
						if (op !== '.') {
							pattern += '\n' + ' '.repeat(indent + 2) + op + ' ';
						}
					}

					if (angular.isDefined(other) && other.length) {
						pattern += (' '.repeat(indent) + '{ ' +
									other.join('\n' + ' '.repeat(indent + 2)) + ' }');
					}

					patterns.push(pattern);
				}

				var spec = atom;
				if ('specifier' in atom) {
					spec = atom.specifier;
				}

				switch (spec.type) {
				case 'closed-specifier':
					if (set === atom.set.name) {
						// first instance of this specifier,
						// add closure constraint
						addConstraint('Closure', set, spec);
					}

					// fallthrough
					case 'open-specifier':
						var assignments = spec.assignments.length;

					for (var i = 0; i < assignments; ++i) {
						var assignment = spec.assignments[i];
						var attribute = maybeBinding(assignment.attribute, 'pq');
						var value = '';
						var optional = false;

						switch (assignment.value.type) {
						case 'literal':
							// fallthrough
						case 'variable':
							value = maybeBinding(assignment.value, 'pqv', handle, assignment);
							break;
						case 'star':
							optional = true;
							// fallthrough
						case 'plus':
							value = '[]'; // blank node
							break;
						}

						if (!optional) {
							// add a pattern to match this assignment
							addPattern(set, attribute, value);
						} else {
							addOptional(set, attribute, value);
						}
					}
					break;

				case 'union':
					var lhs = patternsForSpecifier(spec.specifiers[0], indent, handle);
					var rhs = patternsForSpecifier(spec.specifiers[1], indent, handle);
					optionals = optionals.concat(lhs.optionals, rhs.optionals);

					addGroup(lhs.patterns, 'UNION', rhs.patterns);
					break;

				case 'intersection':
					lhs = patternsForSpecifier(spec.specifiers[0], indent, handle);
					rhs = patternsForSpecifier(spec.specifiers[1], indent, handle);
					optionals = optionals.concat(lhs.optionals, rhs.optionals);

					addGroup(lhs.patterns, '.', rhs.patterns);
					break;

				case 'difference':
					lhs = patternsForSpecifier(spec.specifiers[0], indent, handle);
					rhs = patternsForSpecifier(spec.specifiers[1], indent, handle);
					optionals = optionals.concat(lhs.optionals, rhs.optionals);

					addGroup(lhs.patterns, 'MINUS', rhs.patterns);
					break;

				default:
					$log.debug("unsupported specifier expression type: `" +
							   spec.type + "'");
					break;
				}

				return { patterns: patterns,
						 optionals: optionals
					   };
			}

			switch (atom.type) {
			case 'relational-atom':
				var subject = maybeBinding(atom.arguments[0], 'wd');
				var predicate = maybeBinding(atom.predicate, 'p');
				var statement = bindingOrFreshVarWithEquality(atom.annotation);
				var object = maybeBinding(atom.arguments[1], 'wd');

				addPattern(subject, predicate, statement);

				if (isVar(predicate)) {
					// we don't know the exact predicate (it's a variable),
					// so we have to query for the corresponding node

					var ps = freshVar;
					var property = freshVar();
					addPattern(property, ps, object);
					addPattern(property, 'wikibase:claim', predicate);
					addPattern(property, 'wikibase:statementProperty', ps);
				} else {
					// this is the easy case, we find the corresponding
					// node by replacing the `p'-prefix with `ps. in
					// the predicate

					addPattern(statement, 'ps' + predicate.slice(1), object);
				}

				bindings = bindings.concat([subject, predicate, object]
										   .filter(isVar));
				break;

			case 'specifier-atom':
				// first, make sure that the set variable we use is unique,
				// but remember that we introduced that binding, since the
				// variable might appear in another atom and we'd have to
				// ensure that the corresponding annotations are equal—
				// we can't reuse the variable in the query because it might
				// correspnod to a qualifier for a different statement and
				// thus be a different individual in the reified RDF graph.
				//
				// note that we cannot simply _always_ use a fresh variable,
				// since we do want this variable to join with a relational
				// atom.

				var set = bindingOrFreshVarWithEquality(atom.set);
				bindings.push(set);
				var result = patternsForSpecifier(atom, 0, set);
				patterns = patterns.concat(result.patterns);
				optionals = optionals.concat(result.optionals);

				break;

			default:
				$log.debug("Unkown atom type `" + atom.type +
						   "', don't know how to construct query fragment");
				break;
			}

			return { bindings: bindings,
					 patterns: patterns,
					 optionals: optionals,
					 constraints: constraints
				   };
		}

		function sparqlQueryFromFragments(bindings, patterns, optionals, notExists, limit) {
			var query = "SELECT DISTINCT " + bindings.join(" ") +
				"\nWHERE {\n  " + patterns.join(" .\n  ") +
				((optionals.length) ? "\n  " + optionals.join(" .\n	 ") : '') +
				((notExists.length) ? "\n  FILTER NOT EXISTS {\n    " + notExists.join(" .\n    ") + "\n  }": '') +
				"\n} " + ((isFinite(limit))
						  ? ("LIMIT " + limit)
						  : "");

			return query;
		}

		function verifyCandidateInstance(query) {
			// resolve constraints, if any
			var match = true;

			angular.forEach(query.bindings, function(binding) {
				if (binding.rank === 'deprecated') {
					match = false;
				}
			});

			if (!match) {
				return;
			}

			angular.forEach(query.constraints, function(constraint) {
				if (!match) {
					return;
				}

				var args = constraint.args;
				var bindings = query.bindings;

				switch (constraint.type) {
				case 'Equality':
					if (!angular.equals(copyQualifiers(bindings[args[0]]),
										copyQualifiers(bindings[args[1]]))) {
						match = false;
					}

					break;
				case 'Closure':
					var claim = copyQualifiers(bindings[args[0]]);
					var set = args[1].assignments;
					angular.forEach(claim.qualifiers, function(qualifiers) {
						if (!match) {
							return;
						}

						angular.forEach(qualifiers, function(qualifier) {
							var found = false;

							angular.forEach(set, function(assignment) {
								if (qualifier.property !== assignment.attribute) {
									return;
								}

								switch (assignment.type) {
								case 'literal':
									if (qualifier.value === assignment.value) {
										found = true;
										return;
									}

									break;

								case 'variable':
									// FIXME make sure this works as intended
									if (qualifier.value ===
										bindings[assignment.value].item) {
										found = true;
										return;
									}

									break;

								case 'plus':
									if (qualifier.snaktype === 'novalue') {
										return;
									}

									// fallthrough
								case 'star':
									// don't need to do anything, we don't care about
									// the actual value

									found = true;
									return;

								default:
									throw new RangeError("unsupported value type `" +
														 set[qualifier.property].type +
														 "'");
								}
							});

							if (!found) {
								match = false;
								return;
							}

						});
					});

					break;

				default:
					$log.debug("solving of `" + constraint.type +
							   "' constraints is not implemented yet");

					break;
				}
			});

			return ((match)
					? query
					: undefined);
		}

		return { couldMatch: couldMatch,
				 copyQualifiers: copyQualifiers,
				 verifyCandidateInstance: verifyCandidateInstance,
				 getInstanceCandidatesQuery: getInstanceCandidatesQuery
			   };
	 }]);

	return {};
});
