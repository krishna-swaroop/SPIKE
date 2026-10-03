// SPDX-License-Identifier: MIT
#pragma once

#include <wx/frame.h>
#include <wx/timer.h>
#include <nlohmann/json.hpp>
#include <filesystem>
#include <vector>
#include <map>
#include "worker_bridge.hpp"
#include "project_session.hpp"

class wxPanel;
class wxTextCtrl;
class wxStaticText;
class wxTreeCtrl;
class DarkPages;
class wxSplitterWindow;
class FlatChoice;
class FlatButton;
namespace spike::ui { class VtkCanvas; }

class UiShell final : public wxFrame {
public:
    explicit UiShell(std::filesystem::path resources);

private:
    void BuildWorkspace();
    void Dispatch(const wxString& action);
    void SelectBottom(const wxString& page);
    void SetActiveTab(const wxString& tab);
    void LoadBoard(bool project_only = false);
    void LoadBoardNow(bool project_only);
    void SaveProject(bool save_as = false, std::function<void()> after_save = {});
    void GuardUnsaved(std::function<void()> action);
    void SyncProjectState();
    void MarkDirty();
    void RefreshProjectChrome();
    void ShowProjectManager();
    void NewProject();
    void ShowPrototypePanel(const wxString& title);
    void PopulateNavigator();
    void ShowLayerManager();
    void ShowNetManager();
    void ShowStackup();

    std::filesystem::path resources_;
    std::filesystem::path repository_;
    nlohmann::json manifest_;
    nlohmann::json design_;
    std::vector<std::string> managed_nets_;
    std::map<std::string, bool> layer_visibility_;
    bool translucent_{false};
    spike::wxui::WorkerBridge worker_;
    spike::wxui::ProjectSession session_;
    bool dirty_{false};
    std::uint64_t edit_revision_{0};
    wxTimer worker_timer_;
    wxPanel* chrome_{nullptr};
    wxPanel* left_{nullptr};
    wxPanel* right_{nullptr};
    wxPanel* bottom_{nullptr};
    DarkPages* bottom_pages_{nullptr};
    DarkPages* setup_pages_{nullptr};
    wxSplitterWindow* vertical_split_{nullptr};
    wxSplitterWindow* left_split_{nullptr};
    wxSplitterWindow* right_split_{nullptr};
    spike::ui::VtkCanvas* viewport_{nullptr};
    wxTextCtrl* search_{nullptr};
    wxTreeCtrl* scene_tree_{nullptr};
    wxStaticText* worker_status_{nullptr};
    wxStaticText* status_{nullptr};
    FlatChoice* analysis_mode_{nullptr};
    FlatChoice* camera_view_{nullptr};
    std::map<wxString, FlatButton*> viewport_buttons_;
    wxString view_mode_{"3D"};
    wxString simulation_domain_{"pi"};
    wxString current_tab_{"Home"};
    wxString board_path_;
    bool ribbon_visible_{true};
    bool left_open_{true};
    bool right_open_{true};
    bool bottom_open_{true};
};
