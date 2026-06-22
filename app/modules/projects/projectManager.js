(function () {
  function addTextRow(container, label, value) {
    const row = document.createElement("div");
    const labelElement = document.createElement("strong");
    const valueElement = document.createElement("span");

    labelElement.textContent = `${label}: `;
    valueElement.textContent = value;

    row.append(labelElement, valueElement);
    container.appendChild(row);
  }

  function renderProjects(projects) {
    const container = document.getElementById("projectManagerList");
    if (!container) return;

    const fragment = document.createDocumentFragment();

    projects.forEach(project => {
      const card = document.createElement("div");
      const title = document.createElement("div");

      card.className = "task";
      title.className = "section-title";
      title.textContent = project.name;

      card.appendChild(title);
      addTextRow(card, "Estado", project.status);
      addTextRow(card, "Prioridad", project.priority);
      addTextRow(card, "Próximo paso", project.nextStep);
      fragment.appendChild(card);
    });

    container.replaceChildren(fragment);
  }

  async function load() {
    const container = document.getElementById("projectManagerList");
    if (!container) return;

    container.textContent = "Cargando proyectos...";

    try {
      const response = await fetch("/api/projects", {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        throw new Error("No se pudo cargar Project Manager.");
      }

      const data = await response.json();
      renderProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch (error) {
      container.textContent = error.message;
    }
  }

  window.OxkioProjectManager = {
    load
  };
})();
