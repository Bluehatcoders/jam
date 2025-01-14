export {defaultState};

const defaultState = {
  myIdentity: null,
  myId: null,

  roomId: window.existingRoomId ?? null,
  inRoom: null, // === roomId but only if entered
  room: {name: '', description: '', speakers: [], moderators: []},
  iAmSpeaker: false,
  iAmModerator: false,
  identities: {},
  otherDeviceInRoom: false,
  leftStage: false,

  reactions: {},
  handRaised: false,

  soundMuted: true,
  micMuted: false,
  audioFile: null,
  audioFileElement: null,
  myAudio: null,
  audioPlayError: false,

  speaking: new Set(),

  userInteracted: false,
};

export const actions = {
  JOIN: 'join',
  LEAVE_STAGE: 'leave-stage',
  RETRY_MIC: 'retry-mic',
  REACTION: 'reaction',
};
