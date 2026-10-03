// SPDX-License-Identifier: MIT
#include "project_session.hpp"

#include <iostream>
#include <stdexcept>
#include <string>

namespace {

using spike::wxui::ProjectSession;
using spike::wxui::SessionSource;
using Json = nlohmann::json;

void check(bool condition, const char* message) {
    if (!condition) {
        throw std::runtime_error(message);
    }
}

template <typename Exception, typename Function>
void check_throws(Function&& function, const char* message) {
    try {
        function();
    } catch (const Exception&) {
        return;
    }
    throw std::runtime_error(message);
}

void test_requests_are_distinct_and_minimal() {
    const auto open = ProjectSession::project_open_request("board.spike");
    check(open.method == "read_project_package", "project open method drifted");
    check(open.params == Json{{"path", "board.spike"}}, "project open params are not minimal");

    const auto imported = ProjectSession::design_import_request("board.kicad_pcb");
    check(imported.method == "import_design_v2", "design import method drifted");
    check(imported.params == Json{{"path", "board.kicad_pcb"}, {"include_snapshot", true}},
          "design import params are not minimal");
    check(!imported.params.contains("base_package_path"), "design import leaked project state");

    const auto hinted = ProjectSession::design_import_request("board.xml", "ipc-2581");
    check(hinted.params.at("format_hint") == "ipc-2581", "explicit import format was lost");
}

void test_project_round_trip_preserves_opaque_fields() {
    ProjectSession session;
    const Json project = {
        {"format", "spike-project-package/v2"},
        {"project", {{"name", "fixture.spike"}, {"future_project_field", 17}}},
        {"design", {
            {"source_file", "fixture.kicad_pcb"},
            {"source_board", "(kicad_pcb fixture)"},
            {"canonical_design", {
                {"contract", "spike/design-ir/v2"},
                {"nets", Json::array({{{"id", "n1"}, {"future_net_field", "keep"}}})},
            }},
        }},
        {"analysis", {{"mode", "dc"}, {"future_solver_state", {{"revision", 9}}}}},
        {"future_top_level", {{"owner", "newer-client"}}},
    };
    const Json result = {
        {"contract", "spike/project-open-result/v1"},
        {"project", project},
        {"canonical", {
            {"design_ir", {
                {"contract", "spike/design-ir/v2"},
                {"design_id", "canonical-design"},
                {"nets", Json::array({{{"id", "n1"}}})},
            }},
            {"future_canonical_field", true},
        }},
        {"manifest", {{"manifest_payload_sha256", std::string(64, 'a')}}},
        {"future_open_field", Json::array({1, 2, 3})},
    };

    session.accept_project_open("original.spike", result);
    check(session.source() == SessionSource::ProjectPackage, "project source was not recorded");
    check(session.source_result() == result, "complete open result was not retained");
    check(session.project() == project, "complete project snapshot was not retained");
    check(session.design() != nullptr, "project design projection is unavailable");
    check(session.design()->at("design_id") == "canonical-design",
          "renderer received the desktop design wrapper instead of canonical design_ir");

    session.edit_project([](Json& edited) {
        edited["analysis"]["mode"] = "ac";
        edited["analysis"]["power_nets"] = Json::array({"VCC", "GND"});
        edited["analysis"]["pi_setup"] = {
            {"net", "VCC"},
            {"sources", Json::array()},
            {"loads", Json::array()},
        };
    });
    const auto save = session.project_save_request("copy.spike", false);
    check(save.method == "write_project_package", "project save method drifted");
    check(save.params.size() == 5, "project save contains unexpected params");
    check(save.params.at("path") == "copy.spike", "save destination is incorrect");
    check(save.params.at("base_package_path") == "original.spike", "lossless base package is missing");
    check(save.params.at("profile") == "portable_project", "portable project profile is missing");
    check(save.params.at("include_results") == false, "result policy is incorrect");
    check(save.params.at("snapshot")["analysis"]["mode"] == "ac", "explicit edit was lost");
    check(save.params.at("snapshot")["analysis"]["power_nets"] ==
              Json::array({"VCC", "GND"}),
          "managed nets were not written to the Tauri project path");
    check(save.params.at("snapshot")["analysis"]["pi_setup"]["net"] == "VCC",
          "PI setup was not written to the Tauri project path");
    check(save.params.at("snapshot")["analysis"]["future_solver_state"]["revision"] == 9,
          "unknown nested field was lost");
    check(save.params.at("snapshot")["future_top_level"]["owner"] == "newer-client",
          "unknown top-level field was lost");
    check(!save.params.contains("canonical"), "open metadata leaked into save params");
    check(!save.params.contains("manifest"), "manifest leaked into save params");

    session.accept_project_save({
        {"contract", "spike/project-save-result/v1"},
        {"path", "C:/projects/copy.spike"},
        {"manifest", Json::object()},
    });
    check(session.project_path() == "C:/projects/copy.spike", "saved package did not become the next base");
    check(session.project_save_request("again.spike").params.at("base_package_path") ==
              "C:/projects/copy.spike",
          "subsequent save does not preserve the newest package members");
}

void test_design_import_cannot_masquerade_as_project_open() {
    ProjectSession session;
    const Json import_result = {
        {"snapshot", {
            {"contract", "spike/design-snapshot/v1"},
            {"design", {{"nets", Json::array()}}},
            {"canonical_design", {{"contract", "spike/design-ir/v2"}}},
            {"report", {{"issues", Json::array()}}},
        }},
        {"future_import_field", "keep"},
    };
    session.accept_design_import("input.kicad_pcb", import_result);

    check(session.source() == SessionSource::ImportedDesign, "design import source was not recorded");
    check(!session.has_project(), "design import was treated as an open project");
    check(session.project_path().empty(), "design import acquired a package path");
    check(session.design_path() == "input.kicad_pcb", "design source path was lost");
    check(session.source_result() == import_result, "complete import result was not retained");
    check(session.design() != nullptr, "imported design projection is unavailable");
    check_throws<std::logic_error>(
        [&] { (void)session.project_save_request("invalid.spike"); },
        "design import unexpectedly produced a project save request");

    session.create_project_from_import(
        "imported.spike", "(kicad_pcb (version 20240108))");
    check(session.source() == SessionSource::UnsavedProject,
          "import promotion did not create an unsaved project");
    check(session.has_project(), "promoted import has no project snapshot");
    check(session.project_path().empty(), "unsaved imported project acquired a base package");
    check(session.project().at("format") == "spike-project-package/v2",
          "imported project uses the wrong desktop snapshot format");
    check(session.project().at("design").at("source_board") ==
              "(kicad_pcb (version 20240108))",
          "imported project did not retain exact source text");
    check(session.project().at("design").at("source_file") == "input.kicad_pcb",
          "imported project persisted a host path instead of a portable file name");
    check(session.design()->at("contract") == "spike/design-ir/v2",
          "promoted import did not expose canonical design_ir");
    const auto first_save = session.project_save_request("imported.spike");
    check(!first_save.params.contains("base_package_path"),
          "first imported-project save has a nonexistent base package");
}

void test_invalid_response_does_not_destroy_open_project() {
    ProjectSession session;
    session.accept_project_open("stable.spike", {{"project", {{"opaque", 42}}}});
    check_throws<std::invalid_argument>(
        [&] { session.accept_project_open("bad.spike", {{"project", Json::array()}}); },
        "malformed open result was accepted");
    check(session.project_path() == "stable.spike", "malformed response replaced the project path");
    check(session.project().at("opaque") == 42, "malformed response replaced the project snapshot");

    check_throws<std::invalid_argument>(
        [&] { session.edit_project([](Json& value) { value = Json::array(); }); },
        "non-object project edit was accepted");
    check(session.project().at("opaque") == 42, "failed edit was not transactional");
}

}  // namespace

int main() {
    try {
        test_requests_are_distinct_and_minimal();
        test_project_round_trip_preserves_opaque_fields();
        test_design_import_cannot_masquerade_as_project_open();
        test_invalid_response_does_not_destroy_open_project();
        std::cout << "project_session_test: all checks passed\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "project_session_test: " << error.what() << '\n';
        return 1;
    }
}
