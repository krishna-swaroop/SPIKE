// SPDX-License-Identifier: MIT
#include "vtk_canvas.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <map>
#include <optional>
#include <string>
#include <utility>

#include <nlohmann/json.hpp>
#include <vtkActor.h>
#include <vtkCallbackCommand.h>
#include <vtkCamera.h>
#include <vtkCommand.h>
#include <vtkCubeSource.h>
#include <vtkDiskSource.h>
#include <vtkGenericOpenGLRenderWindow.h>
#include <vtkLineSource.h>
#include <vtkMath.h>
#include <vtkNew.h>
#include <vtkPolyDataMapper.h>
#include <vtkProperty.h>
#include <vtkRenderer.h>
#include <vtkTubeFilter.h>
#include <wx/dcclient.h>

namespace spike::ui {
namespace {

constexpr std::size_t kMaxTracks = 20'000;
constexpr std::size_t kMaxPads = 20'000;
constexpr std::size_t kMaxVias = 20'000;
constexpr std::size_t kMaxOutlines = 5'000;
constexpr double kMaxCoordinate = 1'000'000.0;
constexpr double kMinFeature = 0.001;

const int* GlAttributes() {
    static const int attributes[] = {
        WX_GL_RGBA, WX_GL_DOUBLEBUFFER, WX_GL_DEPTH_SIZE, 24, 0};
    return attributes;
}

std::optional<double> FiniteNumber(const nlohmann::json& object, const char* key) {
    const auto it = object.find(key);
    if (it == object.end() || !it->is_number()) return std::nullopt;
    const double value = it->get<double>();
    return std::isfinite(value) && std::abs(value) <= kMaxCoordinate
               ? std::optional<double>(value) : std::nullopt;
}

std::optional<std::array<double, 2>> Point(const nlohmann::json& value) {
    double x = 0.0;
    double y = 0.0;
    if (value.is_array() && value.size() >= 2 && value[0].is_number() &&
        value[1].is_number()) {
        x = value[0].get<double>();
        y = value[1].get<double>();
    } else if (value.is_object()) {
        const auto px = FiniteNumber(value, "x"), py = FiniteNumber(value, "y");
        if (!px || !py) return std::nullopt;
        x = *px; y = *py;
    } else {
        return std::nullopt;
    }
    if (!std::isfinite(x) || !std::isfinite(y) ||
        std::abs(x) > kMaxCoordinate || std::abs(y) > kMaxCoordinate) {
        return std::nullopt;
    }
    return std::array<double, 2>{x, y};
}

std::optional<std::array<double, 2>> MemberPoint(const nlohmann::json& value,
                                                   const char* first, const char* second = nullptr) {
    auto it = value.find(first);
    if (it != value.end()) return Point(*it);
    if (second) { it = value.find(second); if (it != value.end()) return Point(*it); }
    return std::nullopt;
}

vtkSmartPointer<vtkActor> AddBox(vtkRenderer* renderer, double x, double y, double z,
                                 double width, double height, const std::array<double, 3>& color) {
    vtkNew<vtkCubeSource> cube;
    cube->SetCenter(x, y, z);
    cube->SetXLength(width);
    cube->SetYLength(height);
    cube->SetZLength(kMinFeature);
    vtkNew<vtkPolyDataMapper> mapper;
    mapper->SetInputConnection(cube->GetOutputPort());
    auto actor = vtkSmartPointer<vtkActor>::New();
    actor->SetMapper(mapper);
    actor->GetProperty()->SetColor(color[0], color[1], color[2]);
    renderer->AddActor(actor);
    return actor;
}

vtkSmartPointer<vtkActor> AddTrack(vtkRenderer* renderer, const std::array<double, 2>& start,
                                   const std::array<double, 2>& end, double width, double z,
                                   const std::array<double, 3>& color = {0.82, 0.50, 0.12}) {
    vtkNew<vtkLineSource> line;
    line->SetPoint1(start[0], start[1], z);
    line->SetPoint2(end[0], end[1], z);
    vtkNew<vtkTubeFilter> tube;
    tube->SetInputConnection(line->GetOutputPort());
    tube->SetRadius(width * 0.5);
    tube->SetNumberOfSides(10);
    tube->CappingOn();
    vtkNew<vtkPolyDataMapper> mapper;
    mapper->SetInputConnection(tube->GetOutputPort());
    auto actor = vtkSmartPointer<vtkActor>::New();
    actor->SetMapper(mapper);
    actor->GetProperty()->SetColor(color[0], color[1], color[2]);
    renderer->AddActor(actor);
    return actor;
}

vtkSmartPointer<vtkActor> AddDisc(vtkRenderer* renderer, double x, double y,
                                  double z, double diameter) {
    vtkNew<vtkDiskSource> disc;
    disc->SetInnerRadius(0.0);
    disc->SetOuterRadius(diameter * 0.5);
    disc->SetCircumferentialResolution(24);
    vtkNew<vtkPolyDataMapper> mapper;
    mapper->SetInputConnection(disc->GetOutputPort());
    auto actor = vtkSmartPointer<vtkActor>::New();
    actor->SetMapper(mapper);
    actor->SetPosition(x, y, z);
    actor->GetProperty()->SetColor(0.83, 0.63, 0.18);
    renderer->AddActor(actor);
    return actor;
}

const nlohmann::json* ArrayMember(const nlohmann::json& object,
                                  const char* key) {
    const auto it = object.find(key);
    return it != object.end() && it->is_array() ? &*it : nullptr;
}

}  // namespace

VtkCanvas::VtkCanvas(wxWindow* parent, wxWindowID id)
    : wxGLCanvas(parent, id, GlAttributes(), wxDefaultPosition, wxDefaultSize,
                 wxFULL_REPAINT_ON_RESIZE | wxBORDER_NONE),
      context_(this),
      render_window_(vtkSmartPointer<vtkGenericOpenGLRenderWindow>::New()),
      renderer_(vtkSmartPointer<vtkRenderer>::New()) {
    SetBackgroundStyle(wxBG_STYLE_PAINT);
    render_window_->AddRenderer(renderer_);
    render_window_->SetOwnContext(false);
    context_callback_ = vtkSmartPointer<vtkCallbackCommand>::New();
    context_callback_->SetClientData(this);
    context_callback_->SetCallback(&VtkCanvas::OnRenderWindowEvent);
    for (const auto event : {vtkCommand::WindowMakeCurrentEvent,
                             vtkCommand::WindowIsCurrentEvent,
                             vtkCommand::WindowFrameEvent,
                             vtkCommand::WindowSupportsOpenGLEvent,
                             vtkCommand::WindowIsDirectEvent}) {
        render_window_->AddObserver(event, context_callback_);
    }
    renderer_->SetBackground(0.047, 0.082, 0.106);
    renderer_->SetBackground2(0.055, 0.090, 0.114);
    renderer_->GradientBackgroundOn();

    Bind(wxEVT_PAINT, &VtkCanvas::OnPaint, this);
    Bind(wxEVT_SIZE, &VtkCanvas::OnSize, this);
    Bind(wxEVT_ERASE_BACKGROUND, &VtkCanvas::OnEraseBackground, this);
    for (const auto event : {wxEVT_LEFT_DOWN, wxEVT_LEFT_UP, wxEVT_MIDDLE_DOWN,
                             wxEVT_MIDDLE_UP, wxEVT_RIGHT_DOWN, wxEVT_RIGHT_UP,
                             wxEVT_MOTION, wxEVT_MOUSEWHEEL}) {
        Bind(event, &VtkCanvas::OnMouse, this);
    }
    Bind(wxEVT_MOUSE_CAPTURE_LOST, [this](wxMouseCaptureLostEvent&) { drag_mode_ = DragMode::None; });
    ClearScene();
}

VtkCanvas::~VtkCanvas() {
    render_window_->RemoveObservers(vtkCommand::AnyEvent, context_callback_);
    if (IsShownOnScreen() && SetCurrent(context_)) {
        render_window_->Finalize();
    }
}

void VtkCanvas::OnRenderWindowEvent(vtkObject*, unsigned long event,
                                    void* client_data, void* call_data) {
    auto* canvas = static_cast<VtkCanvas*>(client_data);
    if (!canvas || !canvas->context_.IsOK()) return;
    if (event == vtkCommand::WindowMakeCurrentEvent) {
        canvas->SetCurrent(canvas->context_);
    } else if (event == vtkCommand::WindowIsCurrentEvent) {
        if (call_data) *static_cast<bool*>(call_data) = canvas->SetCurrent(canvas->context_);
    } else if (event == vtkCommand::WindowSupportsOpenGLEvent ||
               event == vtkCommand::WindowIsDirectEvent) {
        if (call_data) *static_cast<int*>(call_data) = 1;
    } else if (event == vtkCommand::WindowFrameEvent) {
        canvas->SwapBuffers();
    }
}

void VtkCanvas::EnsureInitialized() {
    if (initialized_ || !context_.IsOK() || !SetCurrent(context_)) {
        return;
    }
    render_window_->SetReadyForRendering(true);
    render_window_->OpenGLInitContext();
    initialized_ = true;
}

void VtkCanvas::Render() {
    if (!IsShownOnScreen()) {
        return;
    }
    EnsureInitialized();
    if (!initialized_ || !SetCurrent(context_)) {
        return;
    }
    const wxSize size = GetClientSize();
    if (size.x <= 0 || size.y <= 0) {
        return;
    }
    render_window_->SetSize(size.x, size.y);
    render_window_->Render();
}

void VtkCanvas::ClearScene() {
    renderer_->RemoveAllViewProps();
    layer_names_.clear();
    layer_visibility_.clear();
    layer_actors_.clear();
    board_bounds_.reset();
    renderer_->SetBackground(0.047, 0.082, 0.106);
    vtkCamera* camera = renderer_->GetActiveCamera();
    camera->SetFocalPoint(0.0, 0.0, 0.0);
    camera->SetPosition(110.0, -110.0, 95.0);
    camera->SetViewUp(0.0, 0.0, 1.0);
    camera->ParallelProjectionOff();
    Refresh(false);
}

void VtkCanvas::SetLayerVisible(const std::string& name, bool visible) {
    const auto it = layer_actors_.find(name);
    if (it == layer_actors_.end()) return;
    layer_visibility_[name] = visible;
    for (const auto& actor : it->second) actor->SetVisibility(visible);
    Refresh(false);
}

void VtkCanvas::SetTranslucent(bool translucent) {
    translucent_ = translucent;
    for (const auto& [name, actors] : layer_actors_) {
        for (const auto& actor : actors)
            actor->GetProperty()->SetOpacity(translucent ? 0.45 : 1.0);
    }
    Refresh(false);
}

void VtkCanvas::SetTopView() {
    vtkCamera* camera = renderer_->GetActiveCamera();
    camera->SetFocalPoint(0.0, 0.0, 0.0);
    camera->SetPosition(0.0, 0.0, 150.0);
    camera->SetViewUp(0.0, 1.0, 0.0);
    camera->ParallelProjectionOn();
    Fit();
}

void VtkCanvas::SetBottomView() {
    vtkCamera* camera = renderer_->GetActiveCamera();
    camera->SetFocalPoint(0.0, 0.0, 0.0);
    camera->SetPosition(0.0, 0.0, -150.0);
    camera->SetViewUp(0.0, -1.0, 0.0);
    camera->ParallelProjectionOn();
    Fit();
}

void VtkCanvas::SetIsometricView() {
    vtkCamera* camera = renderer_->GetActiveCamera();
    camera->SetFocalPoint(0.0, 0.0, 0.0);
    camera->SetPosition(110.0, -110.0, 95.0);
    camera->SetViewUp(0.0, 0.0, 1.0);
    camera->ParallelProjectionOff();
    Fit();
}

void VtkCanvas::SetCameraView(const std::string& view) {
    if (view == "top") { SetTopView(); return; }
    if (view == "bottom") { SetBottomView(); return; }
    if (view == "iso") { SetIsometricView(); return; }
    vtkCamera* camera = renderer_->GetActiveCamera();
    camera->SetFocalPoint(0.0, 0.0, 0.0);
    if (view == "front") {
        camera->SetPosition(0.0, -150.0, 0.0);
        camera->SetViewUp(0.0, 0.0, 1.0);
    } else if (view == "back") {
        camera->SetPosition(0.0, 150.0, 0.0);
        camera->SetViewUp(0.0, 0.0, 1.0);
    } else if (view == "left") {
        camera->SetPosition(-150.0, 0.0, 0.0);
        camera->SetViewUp(0.0, 0.0, 1.0);
    } else if (view == "right") {
        camera->SetPosition(150.0, 0.0, 0.0);
        camera->SetViewUp(0.0, 0.0, 1.0);
    } else return;
    camera->ParallelProjectionOn();
    Fit();
}

void VtkCanvas::SetNavigationMode(const std::string& mode) {
    if (mode == "orbit") left_drag_mode_ = DragMode::Orbit;
    else if (mode == "pan") left_drag_mode_ = DragMode::Pan;
}

void VtkCanvas::Pan(double dx, double dy) {
    if (!std::isfinite(dx) || !std::isfinite(dy)) return;
    vtkCamera* camera = renderer_->GetActiveCamera();
    const wxSize size = GetClientSize();
    const double scale = camera->GetDistance() / std::max(1, size.y);
    double right[3];
    vtkMath::Cross(camera->GetDirectionOfProjection(), camera->GetViewUp(), right);
    const double motion[3] = {
        scale * (dx * right[0] - dy * camera->GetViewUp()[0]),
        scale * (dx * right[1] - dy * camera->GetViewUp()[1]),
        scale * (dx * right[2] - dy * camera->GetViewUp()[2])};
    double position[3], focal[3];
    camera->GetPosition(position);
    camera->GetFocalPoint(focal);
    camera->SetPosition(position[0] - motion[0], position[1] - motion[1], position[2] - motion[2]);
    camera->SetFocalPoint(focal[0] - motion[0], focal[1] - motion[1], focal[2] - motion[2]);
    renderer_->ResetCameraClippingRange();
    Refresh(false);
}

void VtkCanvas::Zoom(double factor) {
    if (!std::isfinite(factor) || factor <= 0.0 || factor > 100.0) return;
    renderer_->GetActiveCamera()->Dolly(factor);
    renderer_->ResetCameraClippingRange();
    Refresh(false);
}

void VtkCanvas::Fit() {
    if (board_bounds_) {
        const auto& b = *board_bounds_;
        double bounds[6] = {b[0], b[2], b[1], b[3], -0.5, 0.5};
        renderer_->ResetCamera(bounds);
    } else renderer_->ResetCamera();
    renderer_->ResetCameraClippingRange();
    Refresh(false);
}

void VtkCanvas::LoadBoardJson(const nlohmann::json& board) {
    if (!board.is_object()) {
        ClearScene();
        return;
    }

    ClearScene();
    std::map<std::string, std::string> layer_ids;
    std::map<std::string, double> layer_z;
    if (const auto* layers = ArrayMember(board, "layers")) {
        for (const auto& layer : *layers) {
            if (!layer.is_object()) continue;
            const auto name = layer.value("name", std::string{});
            if (name.empty()) continue;
            if (std::find(layer_names_.begin(), layer_names_.end(), name) == layer_names_.end())
                layer_names_.push_back(name);
            layer_visibility_[name] = true;
            if (const auto id = layer.find("id"); id != layer.end() && id->is_string())
                layer_ids[id->get<std::string>()] = name;
            if (const auto z = FiniteNumber(layer, "z_mm")) layer_z[name] = *z;
        }
    }
    const auto layer_name = [&](const nlohmann::json& item, const char* singular) {
        std::string key;
        if (auto it = item.find(singular); it != item.end() && it->is_string()) key = it->get<std::string>();
        if (key.empty()) {
            const auto field = std::string(singular) + "_id";
            if (auto it = item.find(field); it != item.end() && it->is_string()) key = it->get<std::string>();
        }
        if (const auto found = layer_ids.find(key); found != layer_ids.end()) key = found->second;
        return key;
    };
    const auto add_actor = [&](const std::string& layer, vtkSmartPointer<vtkActor> actor) {
        if (layer.empty()) { renderer_->RemoveActor(actor); return; }
        if (layer_visibility_.find(layer) == layer_visibility_.end()) {
            layer_names_.push_back(layer);
            layer_visibility_[layer] = true;
        }
        actor->GetProperty()->SetOpacity(translucent_ ? 0.45 : 1.0);
        layer_actors_[layer].push_back(actor);
    };
    const auto z_for = [&](const std::string& layer) {
        const auto found = layer_z.find(layer);
        return found == layer_z.end() ? 0.0 : found->second;
    };

    // Explicit Edge.Cuts drawings and region loops are shown as outlines.
    // A bounding box from metadata is only a camera hint, never board material.
    if (auto meta = board.find("metadata"); meta != board.end() && meta->is_object()) {
        if (const auto* b = ArrayMember(*meta, "board_bounds_mm"); b && b->size() == 4) {
            std::array<double, 4> values{};
            bool valid = true;
            for (std::size_t i = 0; i < 4; ++i) {
                if (!(*b)[i].is_number()) { valid = false; break; }
                values[i] = (*b)[i].get<double>();
                if (!std::isfinite(values[i]) || std::abs(values[i]) > kMaxCoordinate) valid = false;
            }
            if (valid && values[2] > values[0] && values[3] > values[1]) board_bounds_ = values;
        }
        if (const auto* drawings = ArrayMember(*meta, "board_outline_drawings")) {
            for (std::size_t i = 0; i < std::min(drawings->size(), kMaxOutlines); ++i) {
                const auto& d = (*drawings)[i];
                if (!d.is_object()) continue;
                const auto start = MemberPoint(d, "start", "start_mm");
                const auto end = MemberPoint(d, "end", "end_mm");
                if (!start || !end || *start == *end) continue;
                const auto kind = d.value("type", std::string{});
                if (kind == "line") {
                    add_actor("Edge.Cuts", AddTrack(renderer_, *start, *end, 0.05, 0.0,
                                                       {0.48, 0.68, 0.60}));
                } else if (kind == "rect") {
                    const std::array<double, 2> b{(*end)[0], (*start)[1]};
                    const std::array<double, 2> c{(*start)[0], (*end)[1]};
                    for (const auto& edge : {std::pair{*start, b}, std::pair{b, *end},
                                             std::pair{*end, c}, std::pair{c, *start}})
                        add_actor("Edge.Cuts", AddTrack(renderer_, edge.first, edge.second,
                                                           0.05, 0.0, {0.48, 0.68, 0.60}));
                }
            }
        }
    }
    if (const auto* regions = ArrayMember(board, "regions")) {
        std::size_t edges = 0;
        for (const auto& region : *regions) {
            if (edges >= kMaxOutlines || !region.is_object()) break;
            auto outlines = region.find("outlines_mm");
            if (outlines == region.end()) outlines = region.find("outline");
            if (outlines == region.end() || !outlines->is_array()) continue;
            for (const auto& loop : *outlines) {
                if (!loop.is_array() || loop.size() < 2) continue;
                for (std::size_t j = 1; j < loop.size() && edges < kMaxOutlines; ++j) {
                    const auto a = Point(loop[j - 1]), b = Point(loop[j]);
                    if (a && b && *a != *b) {
                        add_actor("Edge.Cuts", AddTrack(renderer_, *a, *b, 0.05, 0.0,
                                                           {0.48, 0.68, 0.60}));
                        ++edges;
                    }
                }
                const auto first = Point(loop[0]), last = Point(loop[loop.size() - 1]);
                if (first && last && *first != *last && edges < kMaxOutlines) {
                    add_actor("Edge.Cuts", AddTrack(renderer_, *last, *first, 0.05, 0.0,
                                                       {0.48, 0.68, 0.60}));
                    ++edges;
                }
            }
        }
    }

    if (const auto* tracks = ArrayMember(board, "tracks")) {
        const std::size_t count = std::min(tracks->size(), kMaxTracks);
        for (std::size_t i = 0; i < count; ++i) {
            const auto& track = (*tracks)[i];
            if (!track.is_object()) {
                continue;
            }
            std::optional<std::array<double, 2>> start;
            std::optional<std::array<double, 2>> end;
            start = MemberPoint(track, "start_mm", "start");
            end = MemberPoint(track, "end_mm", "end");
            auto width = FiniteNumber(track, "width_mm");
            if (!width) width = FiniteNumber(track, "width");
            const auto layer = layer_name(track, "layer");
            if (!start || !end || *start == *end || !width || *width <= 0 || layer.empty()) continue;
            add_actor(layer, AddTrack(renderer_, *start, *end, *width, z_for(layer)));
        }
    }

    if (const auto* pads = ArrayMember(board, "pads")) {
        const std::size_t count = std::min(pads->size(), kMaxPads);
        for (std::size_t i = 0; i < count; ++i) {
            const auto& pad = (*pads)[i];
            if (!pad.is_object()) {
                continue;
            }
            const auto position = MemberPoint(pad, "center_mm", "at");
            const auto size = MemberPoint(pad, "size_mm", "size");
            if (!position || !size || (*size)[0] <= 0 || (*size)[1] <= 0) continue;
            std::vector<std::string> names;
            if (const auto* layers = ArrayMember(pad, "layers")) {
                for (const auto& item : *layers) if (item.is_string()) {
                    const auto name = item.get<std::string>();
                    if (name == "*.Cu") {
                        for (const auto& known : layer_names_)
                            if (known.size() >= 3 && known.ends_with(".Cu")) names.push_back(known);
                    } else if (name == "F&B.Cu") {
                        names.push_back("F.Cu"); names.push_back("B.Cu");
                    } else names.push_back(name);
                }
            } else if (const auto* layers = ArrayMember(pad, "layer_ids")) {
                for (const auto& item : *layers) if (item.is_string()) {
                    const auto id = item.get<std::string>();
                    const auto match = layer_ids.find(id);
                    names.push_back(match == layer_ids.end() ? id : match->second);
                }
            }
            const auto shape = pad.value("shape", std::string{});
            for (const auto& layer : names) {
                if (layer.empty() || layer == "*.Cu" || layer == "F&B.Cu") continue;
                vtkSmartPointer<vtkActor> actor;
                if (shape == "circle" && std::abs((*size)[0] - (*size)[1]) < 1e-6)
                    actor = AddDisc(renderer_, (*position)[0], (*position)[1], z_for(layer), (*size)[0]);
                else if (shape == "rect" || shape == "rectangle")
                    actor = AddBox(renderer_, (*position)[0], (*position)[1], z_for(layer),
                                   (*size)[0], (*size)[1], {0.83, 0.63, 0.18});
                else continue;
                if (const auto angle = FiniteNumber(pad, "rotation")) {
                    actor->SetOrigin((*position)[0], (*position)[1], z_for(layer));
                    actor->RotateZ(*angle);
                }
                add_actor(layer, actor);
            }
        }
    }
    if (const auto* vias = ArrayMember(board, "vias")) {
        for (std::size_t i = 0; i < std::min(vias->size(), kMaxVias); ++i) {
            const auto& via = (*vias)[i];
            if (!via.is_object()) continue;
            const auto position = MemberPoint(via, "center_mm", "at");
            auto diameter = FiniteNumber(via, "diameter_mm");
            if (!diameter) diameter = FiniteNumber(via, "diameter");
            if (!position || !diameter || *diameter <= 0) continue;
            std::vector<std::string> names;
            if (const auto* layers = ArrayMember(via, "layers")) {
                for (const auto& item : *layers) if (item.is_string()) names.push_back(item.get<std::string>());
            } else {
                for (const char* field : {"start_layer_id", "end_layer_id"}) {
                    if (auto it = via.find(field); it != via.end() && it->is_string()) {
                        const auto id = it->get<std::string>();
                        const auto match = layer_ids.find(id);
                        names.push_back(match == layer_ids.end() ? id : match->second);
                    }
                }
            }
            for (const auto& layer : names)
                if (!layer.empty()) add_actor(layer, AddDisc(renderer_, (*position)[0], (*position)[1],
                                                               z_for(layer), *diameter));
        }
    }
    SetIsometricView();
}

void VtkCanvas::OnPaint(wxPaintEvent&) {
    wxPaintDC paint_dc(this);
    (void)paint_dc;
    Render();
}

void VtkCanvas::OnSize(wxSizeEvent& event) {
    Refresh(false);
    event.Skip();
}

void VtkCanvas::OnEraseBackground(wxEraseEvent&) {}

void VtkCanvas::OnMouse(wxMouseEvent& event) {
    if (event.LeftDown() || event.MiddleDown() || event.RightDown()) {
        last_mouse_ = event.GetPosition();
        drag_mode_ = event.LeftDown() ? left_drag_mode_ : DragMode::Pan;
        if (!HasCapture()) CaptureMouse();
    } else if (event.LeftUp() || event.MiddleUp() || event.RightUp()) {
        drag_mode_ = DragMode::None;
        if (HasCapture()) ReleaseMouse();
    } else if (event.Dragging() && drag_mode_ != DragMode::None) {
        const wxPoint current = event.GetPosition();
        const wxPoint delta = current - last_mouse_;
        last_mouse_ = current;
        vtkCamera* camera = renderer_->GetActiveCamera();
        if (drag_mode_ == DragMode::Orbit) {
            camera->Azimuth(-0.45 * delta.x);
            camera->Elevation(0.45 * delta.y);
            camera->OrthogonalizeViewUp();
        } else {
            Pan(delta.x, delta.y);
        }
        renderer_->ResetCameraClippingRange();
        Refresh(false);
    } else if (event.GetWheelRotation() != 0) {
        const double steps = static_cast<double>(event.GetWheelRotation()) /
                             std::max(1, event.GetWheelDelta());
        Zoom(std::pow(1.12, steps));
    }
}

}  // namespace spike::ui
