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
  // TODO: `notSetValue` doesn't make sense here, figure it out
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
 * passed an additional `fire` parameter that can be used to fire more
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

// Define reducer action handler
const reducer = (reducer, actionType, handler) => {
  if (!reducers[reducer]) {
    reducers[reducer] = defaultReducer();
  }
  reducers[reducer][actionType] = handler;
};

reducers.World = defaultReducer();

// Reduce an action on the world state
const reduce = (state, action, r, ...rest) => {
  const entities = state.get('entities');
  entities.get = entityMapGet;

  // Registered world-reduction?
  if (!('id' in action) && reducers.World[action.type]) {
    return reducers.World[action.type].reduce(state, action, r, ...rest);
  }

  // Accumulate across given id, ids, or all
  const ids = 'id' in action ?
              Array.isArray(action.id) ? action.id : [action.id] :
              entities.keySeq();
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
 * additional `fire` argument which when called with an event queues the
 * event up for execution next. This way events can spawn more events.
 */

const eventQueue = [];

const fire = (action) => eventQueue.push(action);

const eventReduce = (state, action, fire) => {
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

    return reduce(state, action, r, fire);
  });

  // Sanitize
  return next.withMutations((r) =>
    reduce(next, { type: 'SANITIZE' }, r));
};


/*
 * Flush
 *
 * Flush the current event queue by reducing them on the store in order.
 */

const defaultStart = Immutable.fromJS({
  time: 0,
  entities: {},
});

const states = {
  start: defaultStart,
};

// Takes an optional `action` argument to fire before flushing
const flush = (state, action) => {
  const actions = eventQueue.concat([action]);
  eventQueue.length = 0;

  const fire = (action) => actions.push(action);
  while (actions.length > 0) {
    const action = actions.shift();
    if (state === undefined || action.type === 'START') {
      state = defaultStart.merge(states.start);
    }
    if (action.type === 'TICK') {
      REPL.flushEvalInQueue();
    }
    state = eventReduce(state, action, fire);
  }

  return state;
};


/*
 * Flush
 *
 * Flush the current event queue by reducing them on the store in order.
 */

const Scene = connect(
  (state) => ({ state })
)(
  ({ state }) => (
    <View
      key="scene-container"
      style={[Styles.container, { backgroundColor: '#f5fcff' }]}>
      {reduce(state, { type: 'DRAW' }, [])}
    </View>
  )
);


export default {
  merge,

  newId,

  reducer,
  reduce,

  states,

  fire,
  flush,

  Scene,
};
