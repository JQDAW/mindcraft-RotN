// A settings.js stand-in for the G3 driver's tests: safe, but with the console sender `Server` as a
// production task giver, which the driver must refuse (it is test-only).
export default { allow_insecure_coding: false, task_givers: ['JQDAW', 'Server'], profiles: [] };
