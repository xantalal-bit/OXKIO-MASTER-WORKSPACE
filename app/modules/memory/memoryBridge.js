function testMemoryBridge() {
  return {
    ok: true,
    module: "memory",
    bridge: "active"
  };
}

window.OxkioMemoryBridge = {
  testMemoryBridge
};