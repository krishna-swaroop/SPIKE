// SPDX-License-Identifier: MIT
#include "ui_shell.hpp"
#include "flat_choice.hpp"
#include <wx/filedlg.h>
#include <wx/msgdlg.h>
#include <wx/stattext.h>

void UiShell::MarkDirty() {
    dirty_ = true; ++edit_revision_; RefreshProjectChrome();
}

void UiShell::SyncProjectState() {
    session_.edit_project([this](nlohmann::json& project) {
        auto& analysis = project["analysis"];
        if (!analysis.is_object()) analysis = nlohmann::json::object();
        analysis["mode"] = std::string(analysis_mode_->GetStringSelection().ToUTF8().data());
        analysis["power_nets"] = managed_nets_;
        analysis["view_mode"] = std::string(view_mode_.ToUTF8().data());
    });
}

void UiShell::GuardUnsaved(std::function<void()> action) {
    if (worker_.busy()) {
        status_->SetLabel("  Finish or cancel the current worker operation before changing projects."); return;
    }
    if (!dirty_) { action(); return; }
    const int choice = wxMessageBox("Save changes to the current SPIKE project before continuing?",
        "Unsaved project", wxYES_NO | wxCANCEL | wxICON_QUESTION, this);
    if (choice == wxYES) SaveProject(false, std::move(action));
    else if (choice == wxNO) action();
}

void UiShell::SaveProject(bool save_as, std::function<void()> after_save) {
    if (!session_.has_project()) {
        status_->SetLabel("  Import a design or open a project before saving."); return;
    }
    if (!worker_.ready()) {
        status_->SetLabel("  Save unavailable: worker is busy or unavailable."); return;
    }
    wxString path = wxString::FromUTF8(session_.project_path());
    if (save_as || path.empty()) {
        wxFileDialog dialog(this, "Save SPIKE project", {}, "untitled.spike",
            "SPIKE project (*.spike)|*.spike", wxFD_SAVE | wxFD_OVERWRITE_PROMPT);
        if (dialog.ShowModal() != wxID_OK) { status_->SetLabel("  Project save cancelled."); return; }
        path = dialog.GetPath();
        if (!path.Lower().EndsWith(".spike")) path += ".spike";
    }
    try {
        SyncProjectState();
        const auto request = session_.project_save_request(std::string(path.ToUTF8().data()));
        const auto revision = edit_revision_;
        status_->SetLabel("  Saving SPIKE project...");
        const bool sent = worker_.send(request.method, request.params,
            [this, revision, after_save = std::move(after_save)](spike::wxui::WorkerBridge::Reply reply) {
                if (!reply.ok) {
                    status_->SetLabel("  Save failed: " + wxString::FromUTF8(reply.error.message)); return;
                }
                try {
                    session_.accept_project_save(reply.result);
                    if (edit_revision_ == revision) dirty_ = false;
                    RefreshProjectChrome();
                    status_->SetLabel("  Project saved: " + wxString::FromUTF8(session_.project_path()));
                    if (after_save && !dirty_) after_save();
                } catch (const std::exception& error) {
                    status_->SetLabel("  Save response rejected: " + wxString::FromUTF8(error.what()));
                }
            });
        if (!sent) status_->SetLabel("  Save unavailable: " + wxString::FromUTF8(worker_.last_error().message));
    } catch (const std::exception& error) {
        status_->SetLabel("  Save failed: " + wxString::FromUTF8(error.what()));
    }
}
