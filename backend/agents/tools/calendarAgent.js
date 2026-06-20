// OXKIO CALENDAR AGENT V1

class CalendarAgent {

  constructor(toolExecutor) {
    this.name = "CalendarAgent";
    this.version = "1.0";
    this.status = "READY";
    this.toolExecutor = toolExecutor;
  }

  read(range = {}) {
    return this.toolExecutor.execute("calendar.read", {
      range
    });
  }

  create(event = {}) {
    return this.toolExecutor.execute("calendar.create", {
      event
    });
  }

  update(eventId, changes = {}) {
    return this.toolExecutor.execute("calendar.update", {
      eventId,
      changes
    });
  }

  getStatus() {
    return {
      name: this.name,
      version: this.version,
      status: this.status,
      tools: [
        "calendar.read",
        "calendar.create",
        "calendar.update"
      ]
    };
  }

}

module.exports = CalendarAgent;