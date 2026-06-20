// OXKIO MEMORY AGENT V1

class MemoryAgent {

  constructor(toolExecutor) {
    this.name = "MemoryAgent";
    this.version = "1.0";
    this.status = "READY";
    this.toolExecutor = toolExecutor;
  }

  search(query) {
    return this.toolExecutor.execute("memory.search", {
      query
    });
  }

  write(memory) {
    return this.toolExecutor.execute("memory.write", {
      memory
    });
  }

  getStatus() {
    return {
      name: this.name,
      version: this.version,
      status: this.status,
      tools: [
        "memory.search",
        "memory.write"
      ]
    };
  }

}

module.exports = MemoryAgent;