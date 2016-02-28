'use strict';

const React = require('react-native');
const {
  View,
} = React;

const { connect } = require('react-redux/native');
const Immutable = require('immutable');
const uuid = require('uuid-js');

const REPL = require('./REPL').default;
const Styles = require('./Styles').default;

REPL.registerEval('Protux', (c) => eval(c));

const I = Immutable.fromJS;


/*
 * Dispatch Queue
 */

const dispatchQueue = [];

const queueDispatch = (action) => dispatchQueue.push(action);


/*
 * Entity Slot Inheritance
 */

const NOT_SET = {};

const origGet = Immutable.Map.prototype.get;

const entGet = function(k, notSetValue) {
  // First lookup normally
  let result = origGet.call(this, k, NOT_SET);
  if (result !== NOT_SET) {
    return result;
  }

  // Not found? Recurse in protos
  const protoIds = origGet.call(this, 'protoIds');
  if (protoIds) {
    for (let i = 0; i < protoIds.size; ++i) {
      result = entGet.call(origGet.call(this.__EM, protoIds.get(i)), k, NOT_SET);
      if (result !== NOT_SET) {
        return result;
      }
    }
  }

  return notSetValue;
};

const newGet = function(k, notSetValue) {
  // Saved before?
  let wrapper = this.__WRAPPERS && this.__WRAPPERS[k];
  if (wrapper) {
    return wrapper;
  }

  // Create a wrapper that looks in protos
  const e = origGet.call(this, k, notSetValue);
  wrapper = Object.create(e);
  wrapper.__EM = this;
  wrapper.get = entGet;

  // Save for later
  if (!this.__WRAPPERS) {
    this.__WRAPPERS = {};
  }
  this.__WRAPPERS[k] = wrapper;
  return wrapper;
};


/*
 * Entity Reduction
 */

const entityReducers = {};

// Make a new reducer with some initial reductions for actions, runs DEFAULT if
// the incoming action doesn't match a reduction, or returns the state unchanged
// if no DEFAULT
const defaultReducer = (reductions = {}) => ({
  ...reductions,

  reduce(state, action, r, ...rest) {
    const f = this[action.type] || this.DEFAULT;
    if (f) {
      return f(state, action, r, ...rest);
    }
    return r;
  },
});

// Accumulate across entities
const entityReduce = (state, action, r, ...rest) => {
  const entities = state.get('entities');
  entities.get = newGet;

  // Accumulate across given id, ids, or all
  const ids = (action.id && [action.id]) || action.ids || entities.keySeq();
  return ids.reduce((r, id) => (
    // Accumulate across entity's reducers
    (entities.getIn([id, 'reducers']) || []).reduce((r, reducer) => (
      entityReducers[reducer].reduce(state, { ...action, id }, r, ...rest)
    ), r)
  ), r);
};


/*
 * Rectangle
 */

entityReducers.Rectangle = defaultReducer();

entityReducers.Rectangle.DRAW = (state, action, r) => {
  const entities = state.get('entities');
  const x = entities.getIn([action.id, 'x']);
  const y = entities.getIn([action.id, 'y']);
  const w = entities.getIn([action.id, 'w']);
  const h = entities.getIn([action.id, 'h']);
  const color = entities.getIn([action.id, 'color']);

  r.push(
    <View
      key={action.id}
      style={{ position: 'absolute',
               left: x - w / 2, top: y - h / 2,
               width: w, height: h,
               borderRadius: 15,
               backgroundColor: color }}
    />
  );
  return r;
};

entityReducers.Rectangle.TICK = (state, action, r) => {
  const y = state.getIn(['entities', action.id, 'y']);
  const vy = state.getIn(['entities', action.id, 'vy'], 0);
  const ay = state.getIn(['entities', action.id, 'ay'], 300);

  return r.mergeDeep({
    entities: {
      [action.id]: {
        vy: y + vy * action.dt > Styles.screenH ? -vy : vy + ay * action.dt,
        y: Math.min(Styles.screenH, y + vy * action.dt),
      },
    },
  });
};


/*
 * Scene
 */

const startState = I({
  entities: {
    'proto': {
      w: 50, h: 50,
      color: '#f00',
    },

    'test1': {
      reducers: ['Rectangle'],
      protoIds: ['proto'],
      x: 200, y: 400,
    },

    'test2': {
      reducers: ['Rectangle'],
      protoIds: ['proto'],
      x: 150, y: 340,
    },
  },
});

const eventReduce = (state = startState, action, ...rest) => {
  // Start
  if (action.type === 'START') {
    return startState;
  }

  // Accumulate new state with mutations for performance
  return state.withMutations((r) => {
    // Direct state updates
    if (action.type === 'SET_IN') {
      return r.setIn(action.path, action.value);
    }
    if (action.type === 'UPDATE_IN') {
      return r.updateIn(action.path, action.update);
    }
    if (action.type === 'MERGE') {
      return r.mergeDeep(action.data);
    }

    // Tick a clock so we always keep drawing
    if (action.type === 'TICK') {
      r = r.update('time', (t) => t + action.dt);
    }

    return entityReduce(state, action, r, ...rest);
  });
};

const Scene = connect(
  (state) => ({ state })
)(
  ({ state }) => (
    <View
      key="scene-container"
      style={[Styles.container, { backgroundColor: '#f5fcff' }]}>
      {entityReduce(state, { type: 'DRAW' }, [])}
    </View>
  )
);


export {
  dispatchQueue,
  eventReduce,
  Scene,
};
