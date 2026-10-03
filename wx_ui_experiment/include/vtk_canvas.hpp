// SPDX-License-Identifier: MIT
#pragma once

#include <wx/glcanvas.h>
#include <map>
#include <array>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json_fwd.hpp>
#include <vtkActor.h>
#include <vtkSmartPointer.h>

class vtkGenericOpenGLRenderWindow;
class vtkRenderer;
class vtkCallbackCommand;
class vtkObject;

namespace spike::ui {

// A small VTK viewport whose OpenGL context is owned by wxWidgets.  It is a
// presentation-only surface: board JSON is treated as optional display data
// and is never used as an analysis or solver result.
class VtkCanvas final : public wxGLCanvas {
public:
    explicit VtkCanvas(wxWindow* parent, wxWindowID id = wxID_ANY);
    ~VtkCanvas() override;

    void SetTopView();
    void SetBottomView();
    void SetIsometricView();
    void SetCameraView(const std::string& view);
    void SetNavigationMode(const std::string& mode);
    void Pan(double dx, double dy);
    void Zoom(double factor);
    void Fit();
    void ClearScene();
    const std::vector<std::string>& AvailableLayers() const noexcept { return layer_names_; }
    void SetLayerVisible(const std::string& name, bool visible);
    void SetTranslucent(bool translucent);

    // Bounded presentation of explicit SpiDeR v1/v2 tracks, pads, vias and
    // outline edges. Unsupported geometry is omitted, never fabricated.
    void LoadBoardJson(const nlohmann::json& board);

private:
    enum class DragMode { None, Orbit, Pan };

    void EnsureInitialized();
    void Render();
    void OnPaint(wxPaintEvent& event);
    void OnSize(wxSizeEvent& event);
    void OnEraseBackground(wxEraseEvent& event);
    void OnMouse(wxMouseEvent& event);
    static void OnRenderWindowEvent(vtkObject* caller, unsigned long event,
                                    void* client_data, void* call_data);

    wxGLContext context_;
    vtkSmartPointer<vtkGenericOpenGLRenderWindow> render_window_;
    vtkSmartPointer<vtkRenderer> renderer_;
    vtkSmartPointer<vtkCallbackCommand> context_callback_;
    wxPoint last_mouse_;
    DragMode drag_mode_{DragMode::None};
    DragMode left_drag_mode_{DragMode::Orbit};
    bool initialized_{false};
    bool translucent_{false};
    std::vector<std::string> layer_names_;
    std::map<std::string, bool> layer_visibility_;
    std::map<std::string, std::vector<vtkSmartPointer<vtkActor>>> layer_actors_;
    std::optional<std::array<double, 4>> board_bounds_;
};

}  // namespace spike::ui
