'use strict';


const REPL = require('REPL').default;
REPL.registerEval('Fluxpy', (c) => eval(c));


const React = require('react-native');
const {
  View,
} = React;

const Immutable = require('immutable');


const Styles = require('Styles').default;
const Protux = require('Protux').default;


const Media = require('./Media');


/*
 * start
 */

const startState = Immutable.fromJS({
  entities: {},
});


export {
  startState,
};
