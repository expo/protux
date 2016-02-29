/*
 * @providesModule Protux
 */
'use strict';


import patch from 'extensible-polyfill';
patch('immutable');

const REPL = require('REPL').default;
REPL.registerEval('Protux', (c) => eval(c));


const React = require('react-native');
const {
  View,
} = React;

const { connect } = require('react-redux/native');
const Immutable = require('immutable');
const uuid = require('uuid-js');


const Styles = require('Styles').default;


/*
 * Nicer merge
 */

const merge = (a, b) =>
  Immutable.Map.isMap(a) ? a.mergeWith(merge, b) : b;


/*
 * Entity Ids
 */

const newId = () => uuid.create().toString();


/*
 * Entity Slot Inheritance
 *
 * Slot lookup in entities proceeds in depth-first order through the entity
 * itself and its protos recursively until the slot is found.
 */

const NOT_SET = {};

const origGet = Immutable.Map.prototype.get;

const entityGet = function(k, notSetValue) {
  // First lookup normally
  let result = origGet.call(this, k, NOT_SET);
  if (result !== NOT_SET) {
    return result;
  }

  // Not found? Recurse in protos
  const protoIds = origGet.call(this, 'protoIds');
  if (protoIds) {
    for (let i = 0; i < protoIds.size; ++i) {
      const proto = origGet.call(this.__EM, protoIds.get(i));
      result = entityGet.call(proto, k, NOT_SET);
      if (result !== NOT_SET) {
        return result;
      }
    }
  }

  return notSetValue;
};

const entityMapGet = function(k, notSetValue) {
  // Saved before?
  let wrapper = this.__WRAPPERS && this.__WRAPPERS[k];
  if (wrapper) {
    return wrapper;
  }

  // Create a wrapper that looks in protos
  const e = origGet.call(this, k, notSetValue);
  wrapper = Object.create(e);
  wrapper.__EM = this;
  wrapper.get = entityGet;

  // Save for later
  if (!this.__WRAPPERS) {
    this.__WRAPPERS = {};
  }
  this.__WRAPPERS[k] = wrapper;
  return wrapper;
};


/*
 * Entity Reduction
 *
 * Entity reduction reduces an action across all entities in the state to
 * accumulate a return value. The accumulated value doesn't have to only be the
 * next state like in redux, although this is often the case. It can also simply
 * be a React element to draw to the screen, a number if summing up a value
 * across entities, etc. Entity reduction isn't just used for state updates, it
 * can also be used to get other information about the state such as 'How do I
 * draw this?' or 'How many enemies are on screen?'
 *
 * Entities specify reducers that operate on themselves, `Protux.reducers` is a
 * map of all entity reducers currently active.
 *
 * Entity reducers apply to an entity and all its rsubs. TODO: implement this
 *
 * An entity reducer takes arguments (state, action, r, ...rest) where `r` is
 * an accumulator variable and returns the next accumulation. ...rest contains
 * extra parameters specific to the action (for example, event-style actions are
 * passed an additional `dispatch` parameter that can be used to dispatch more
 * events)
 */

const reducers = {};

// Make a new reducer with some initial reductions for actions, runs DEFAULT if
// the incoming action doesn't match a reduction, or returns the accumulation
// unchanged if no DEFAULT
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

// Utility to add reducer action handlers quickly
const on = (reducer, actionType, handler) => {
  if (!reducers[reducer]) {
    reducers[reducer] = defaultReducer();
  }
  reducers[reducer][actionType] = handler;
};

// Accumulate across entities
const entityReduce = (state, action, r, ...rest) => {
  const entities = state.get('entities');
  entities.get = entityMapGet;

  // Accumulate across given id, ids, or all
  const ids = action.id === 'all' ?
              entities.keySeq() :
              Array.isArray(action.id) ? action.id : [action.id];
  return ids.reduce((r, id) => (
    // Accumulate across entity's reducers
    (entities.getIn([id, 'reducers']) || []).reduce((r, reducer) => (
      reducers[reducer].reduce(state, { ...action, id }, r, ...rest)
    ), r)
  ), r);
};


/*
 * Events
 *
 * An event is just an action which when reduced on the current state gives the
 * next state. In the case of an event, entity reducers are also passed an
 * additional `dispatch` argument which when called with an event queues the
 * event up for execution next. This way events can spawn more events.
 */

const eventQueue = [];

const queueEvent = (action) => eventQueue.push(action);

const eventReduce = (state, action, dispatch) => {
  // Accumulate new state with mutations for performance
  const next = state.withMutations((r) => {
    // Direct state updates
    if (action.type === 'SET_IN') {
      return r.setIn(action.path, action.value);
    }
    if (action.type === 'UPDATE_IN') {
      return r.updateIn(action.path, action.update);
    }
    if (action.type === 'MERGE') {
      return merge(r, action.state);
    }
    if (action.type === 'DUMP') {
      REPL.log(state);
      return r;
    }

    // Tick a clock so we always keep drawing
    if (action.type === 'TICK') {
      r = r.update('time', (t) => (t || 0) + action.dt);
    }

    return entityReduce(state, action, r, dispatch);
  });

  // Sanitize
  return next.withMutations((r) =>
    entityReduce(next, { type: 'SANITIZE' }, r));
};


/*
 * Top-level
 *
 * Top-level start state, reducer and react-native component for Protux. This
 * the only part that binds Protux to react-native, the code above is
 * library-agnostic.
 */

const defaultStart = Immutable.fromJS({
  time: 0,
  entities: {},
});

const states = {
  start: defaultStart,
};

const reduce = (state, action) => {
  const actions = eventQueue.concat([action]);
  eventQueue.length = 0;

  const dispatch = (action) => actions.push(action);
  while (actions.length > 0) {
    const action = actions.shift();
    if (state === undefined || action.type === 'START') {
      state = defaultStart.merge(states.start);
    }
    if (action.type === 'TICK') {
      REPL.flushEvalInQueue();
    }
    state = eventReduce(state, action, dispatch);
  }

  return state;
};

const Scene = connect(
  (state) => ({ state })
)(
  ({ state }) => (
    <View
      key="scene-container"
      style={[Styles.container, { backgroundColor: '#f5fcff' }]}>
      {entityReduce(state, { type: 'DRAW', id: 'all' }, [])}
    </View>
  )
);


export default {
  merge,

  newId,

  defaultReducer,
  on,
  reducers,

  queueEvent,

  states,
  reduce,
  Scene,
};
