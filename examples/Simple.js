'use strict';


const REPL = require('REPL').default;
REPL.registerEval('Test', (c) => eval(c));


const React = require('react-native');
const {
  View,
} = React;

const Immutable = require('immutable');


const Styles = require('Styles').default;
const Protux = require('Protux').default;


/*
 * Rectangle
 */

Protux.reducers.Rectangle = Protux.defaultReducer();

Protux.reducers.Rectangle.DRAW = ({
  entities: {
    [action.id]: {
      x, y,
      rot = 0,
      w = 50, h = 50,
      color = 'red',
    },
  },
}, action, r) => {
  r.push(
    <View
      key={action.id}
      style={{ position: 'absolute',
               transform: [{ rotate: rot + 'deg' }],
               left: x - w / 2, top: y - h / 2,
               width: w, height: h,
               borderRadius: 15,
               backgroundColor: color }}
    />
  );
  return r;
};

Protux.reducers.Rectangle.TICK = ({
  entities: { [action.id]: { y, vy = 0, ay = 300 } },
}, action, r) => (
  r.mergeDeep({
    entities: {
      [action.id]: {
        vy: y + vy * action.dt > Styles.screenH ? -vy : vy + ay * action.dt,
        y: Math.min(Styles.screenH, y + vy * action.dt),
      },
    },
  })
);


/*
 * Rotator
 */

Protux.reducers.Rotator = Protux.defaultReducer();

Protux.reducers.Rotator.TICK = ({
  entities: { [action.id]: { rot = 0, rotSpeed = 90 } },
}, action, r) => (
  r.mergeDeep({
    entities: { [action.id]: { rot: rot + rotSpeed * action.dt }},
  })
);


/*
 * start
 */

const startState = Immutable.fromJS({
  entities: {
    'proto': {
      color: '#0f0',
    },

    'test1': {
      reducers: ['Rectangle'],
      protoIds: ['proto'],
      x: 200, y: 400,
    },

    'test2': {
      reducers: ['Rectangle', 'Rotator'],
      protoIds: ['proto'],
      x: 150, y: 340,
      rotSpeed: 210,
    },
  },
});


export {
  startState,
};
