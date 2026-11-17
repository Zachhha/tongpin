'use strict';

// Run both test files in one process. This also works in environments where
// the Node test runner cannot spawn child processes.
require('./game.test');
require('./guess.test');
require('./crisis.test');
require('./poem.test');
require('./server.test');
