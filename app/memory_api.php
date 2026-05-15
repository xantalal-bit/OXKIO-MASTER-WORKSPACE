<?php
header("Content-Type: application/json; charset=UTF-8");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");

$host = "localhost";
$db   = "mmkldmoh_oxkio_memory";
$user = "mmkldmoh_oxkio_user";
$pass = "Oxkio#2026!Secure9";

$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    echo json_encode(["ok" => false, "error" => "conexion"]);
    exit;
}

$conn->set_charset("utf8mb4");

$action = $_GET["action"] ?? "";
$question = $_GET["question"] ?? "";
$answer = $_GET["answer"] ?? "";

if ($action === "save") {
    if ($question === "" || $answer === "") {
        echo json_encode(["ok" => false, "error" => "faltan_datos"]);
        exit;
    }

    $stmt = $conn->prepare("INSERT INTO memory (question, answer) VALUES (?, ?)");
    $stmt->bind_param("ss", $question, $answer);

    if ($stmt->execute()) {
        echo json_encode([
            "ok" => true,
            "message" => "memoria_guardada",
            "id" => $stmt->insert_id
        ]);
    } else {
        echo json_encode(["ok" => false, "error" => "no_guardado"]);
    }

    $stmt->close();
    $conn->close();
    exit;
}

if ($question !== "") {
    $search = "%" . $question . "%";

    $stmt = $conn->prepare("SELECT id, question, answer, created_at FROM memory WHERE question LIKE ? ORDER BY id DESC LIMIT 1");
    $stmt->bind_param("s", $search);
    $stmt->execute();

    $res = $stmt->get_result();

    if ($res && $res->num_rows > 0) {
        $row = $res->fetch_assoc();
        echo json_encode([
            "ok" => true,
            "found" => true,
            "memory" => $row
        ]);
    } else {
        echo json_encode([
            "ok" => true,
            "found" => false,
            "answer" => "No encontrado"
        ]);
    }

    $stmt->close();
    $conn->close();
    exit;
}

echo json_encode([
    "ok" => true,
    "status" => "Oxkio memory API activa"
]);

$conn->close();
?>