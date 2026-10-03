// SPDX-License-Identifier: MIT
#include "project_session.hpp"

#include <stdexcept>
#include <utility>

namespace spike::wxui {
namespace {

void require_path(const std::string& path, const char* operation) {
    if (path.empty()) {
        throw std::invalid_argument(std::string(operation) + " requires a path.");
    }
}

std::string portable_file_name(const std::string& path) {
    const auto separator = path.find_last_of("/\\");
    return separator == std::string::npos ? path : path.substr(separator + 1);
}

const nlohmann::json& require_object_member(
    const nlohmann::json& value, const char* member, const char* operation) {
    if (!value.is_object()) {
        throw std::invalid_argument(std::string(operation) + " result must be an object.");
    }
    const auto found = value.find(member);
    if (found == value.end() || !found->is_object()) {
        throw std::invalid_argument(
            std::string(operation) + " result is missing object field '" + member + "'.");
    }
    return *found;
}

}  // namespace

WorkerRequest ProjectSession::project_open_request(std::string path) {
    require_path(path, "Project open");
    return {"read_project_package", {{"path", std::move(path)}}};
}

WorkerRequest ProjectSession::design_import_request(
    std::string path, std::string format_hint) {
    require_path(path, "Design import");
    Json params{{"path", std::move(path)}, {"include_snapshot", true}};
    if (!format_hint.empty()) {
        params["format_hint"] = std::move(format_hint);
    }
    return {"import_design_v2", std::move(params)};
}

void ProjectSession::accept_project_open(
    std::string path, const Json& worker_result) {
    require_path(path, "Project open");
    const Json& opened_project = require_object_member(
        worker_result, "project", "Project open");

    // Commit only after validation so a malformed response cannot destroy the
    // currently open session.
    Json next_result = worker_result;
    Json next_project = opened_project;
    source_ = SessionSource::ProjectPackage;
    source_result_ = std::move(next_result);
    project_ = std::move(next_project);
    project_path_ = std::move(path);
    design_path_.clear();
}

void ProjectSession::accept_design_import(
    std::string path, const Json& worker_result) {
    require_path(path, "Design import");
    const Json& snapshot = require_object_member(
        worker_result, "snapshot", "Design import");
    require_object_member(snapshot, "design", "Design import snapshot");

    Json next_result = worker_result;
    source_ = SessionSource::ImportedDesign;
    source_result_ = std::move(next_result);
    project_ = Json();
    project_path_.clear();
    design_path_ = std::move(path);
}

void ProjectSession::create_project_from_import(
    std::string project_name, std::string source_text,
    std::string source_format) {
    if (source_ != SessionSource::ImportedDesign || !source_result_.is_object()) {
        throw std::logic_error("A design import must be accepted before creating its project.");
    }
    if (project_name.empty()) {
        throw std::invalid_argument("An imported project requires a name.");
    }
    if (source_text.empty()) {
        throw std::invalid_argument("An imported project requires its UTF-8 source text.");
    }
    if (source_format.empty()) {
        throw std::invalid_argument("An imported project requires a source format.");
    }

    const Json& snapshot = require_object_member(
        source_result_, "snapshot", "Design import");
    const Json& imported_design = require_object_member(
        snapshot, "design", "Design import snapshot");
    const Json& canonical_design = require_object_member(
        snapshot, "canonical_design", "Design import snapshot");

    Json design = {
        {"canonical_design", canonical_design},
        {"source_file", portable_file_name(design_path_)},
        {"source_format", std::move(source_format)},
        {"source_board", std::move(source_text)},
        {"stackup", imported_design.value("stackup", Json::array())},
    };
    if (const auto technology = imported_design.find("technology");
        technology != imported_design.end()) {
        design["technology"] = *technology;
    }
    if (const auto regions = imported_design.find("regions");
        regions != imported_design.end()) {
        design["regions"] = *regions;
    }

    project_ = {
        {"format", "spike-project-package/v2"},
        {"contract", "spike/project/v2"},
        {"project", {{"name", std::move(project_name)}}},
        {"design", std::move(design)},
        {"analysis", Json::object()},
    };
    source_ = SessionSource::UnsavedProject;
    project_path_.clear();
}

void ProjectSession::edit_project(const ProjectEdit& edit) {
    if (!has_project()) {
        throw std::logic_error("A project snapshot must exist before it can be edited.");
    }
    if (!edit) {
        throw std::invalid_argument("A project edit callback is required.");
    }

    Json edited = project_;
    edit(edited);
    if (!edited.is_object()) {
        throw std::invalid_argument("A project edit must leave the project snapshot as an object.");
    }
    project_ = std::move(edited);
}

WorkerRequest ProjectSession::project_save_request(
    std::string destination_path, bool include_results) const {
    require_path(destination_path, "Project save");
    if (!has_project()) {
        throw std::logic_error(
            "A complete project snapshot is required; a design import is not a project open.");
    }

    Json params{
        {"path", std::move(destination_path)},
        {"snapshot", project_},
        {"profile", "portable_project"},
        {"include_results", include_results},
    };
    if (!project_path_.empty()) {
        // The worker uses the verified source package to preserve opaque ZIP
        // members and future canonical fields during Save and Save As.
        params["base_package_path"] = project_path_;
    }
    return {"write_project_package", std::move(params)};
}

void ProjectSession::accept_project_save(const Json& worker_result) {
    if (!has_project()) {
        throw std::logic_error("There is no project snapshot associated with this save.");
    }
    if (!worker_result.is_object()) {
        throw std::invalid_argument("Project save result must be an object.");
    }
    const auto path = worker_result.find("path");
    if (path == worker_result.end() || !path->is_string() || path->get_ref<const std::string&>().empty()) {
        throw std::invalid_argument("Project save result is missing string field 'path'.");
    }
    project_path_ = path->get<std::string>();
    source_ = SessionSource::ProjectPackage;
}

void ProjectSession::clear() noexcept {
    source_ = SessionSource::Empty;
    source_result_ = Json();
    project_ = Json();
    project_path_.clear();
    design_path_.clear();
}

SessionSource ProjectSession::source() const noexcept {
    return source_;
}

bool ProjectSession::has_project() const noexcept {
    return (source_ == SessionSource::UnsavedProject ||
            source_ == SessionSource::ProjectPackage) && project_.is_object();
}

const ProjectSession::Json& ProjectSession::project() const {
    if (!has_project()) {
        throw std::logic_error("No project package is open.");
    }
    return project_;
}

const ProjectSession::Json& ProjectSession::source_result() const noexcept {
    return source_result_;
}

const ProjectSession::Json* ProjectSession::design() const noexcept {
    if (has_project()) {
        // Prefer the worker's canonical design. project.design is a desktop
        // persistence wrapper containing source text and UI metadata, not a
        // SpiDeR document suitable for the renderer.
        if (source_result_.is_object()) {
            const auto canonical = source_result_.find("canonical");
            if (canonical != source_result_.end() && canonical->is_object()) {
                const auto found = canonical->find("design_ir");
                if (found != canonical->end() && found->is_object()) {
                    return &*found;
                }
            }
        }
        const auto wrapper = project_.find("design");
        if (wrapper != project_.end() && wrapper->is_object()) {
            const auto canonical = wrapper->find("canonical_design");
            if (canonical != wrapper->end() && canonical->is_object()) {
                return &*canonical;
            }
            if (const auto contract = wrapper->find("contract");
                contract != wrapper->end() && contract->is_string()) {
                return &*wrapper;
            }
        }
        return nullptr;
    }
    if (source_ == SessionSource::ImportedDesign && source_result_.is_object()) {
        const auto snapshot = source_result_.find("snapshot");
        if (snapshot != source_result_.end() && snapshot->is_object()) {
            const auto found = snapshot->find("design");
            return found != snapshot->end() && found->is_object() ? &*found : nullptr;
        }
    }
    return nullptr;
}

const std::string& ProjectSession::project_path() const noexcept {
    return project_path_;
}

const std::string& ProjectSession::design_path() const noexcept {
    return design_path_;
}

}  // namespace spike::wxui
