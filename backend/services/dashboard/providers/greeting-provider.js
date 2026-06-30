function getGreeting(timestamp) {
  return {
    text: "Buenos dias. Oxkio Dashboard Intelligence esta operativo.",
    generatedAt: timestamp,
    source: "mock"
  };
}

module.exports = {
  getGreeting
};
