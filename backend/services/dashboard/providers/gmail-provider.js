function getGmail(timestamp) {
  return {
    inbox: {
      unread: 0,
      priority: 0,
      requiresReview: 0
    },
    highlights: [],
    updatedAt: timestamp,
    source: "mock"
  };
}

module.exports = {
  getGmail
};
