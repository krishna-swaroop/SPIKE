// SPDX-License-Identifier: MIT
#include "ui_shell.hpp"

#include <wx/app.h>
#include <wx/msgdlg.h>
#include <wx/stdpaths.h>

#include <filesystem>
#include <exception>

namespace {
std::filesystem::path Resources() {
    const auto executable = std::filesystem::path(wxStandardPaths::Get().GetExecutablePath().ToStdWstring());
    const auto adjacent = executable.parent_path();
    if (std::filesystem::exists(adjacent / "ui_manifest.json")) return adjacent;
    const auto current = std::filesystem::current_path();
    if (std::filesystem::exists(current / "ui_manifest.json")) return current;
    if (std::filesystem::exists(current / "wx_ui_experiment" / "ui_manifest.json")) return current / "wx_ui_experiment";
    return adjacent;
}

class SpikeReplicaApp final : public wxApp {
public:
    bool OnInit() override {
        try {
            auto* frame = new UiShell(Resources());
            frame->Show();
            return true;
        } catch (const std::exception& error) {
            wxMessageBox(wxString::FromUTF8(error.what()), "SPIKE experiment startup failed", wxOK | wxICON_ERROR);
            return false;
        }
    }
};
}  // namespace

wxIMPLEMENT_APP(SpikeReplicaApp);
