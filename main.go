package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Create an instance of the app structure
	justUpdated := updatedFrom()
	app := NewApp()
	app.justUpdated = justUpdated

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "Hopline",
		Width:     1280,
		Height:    800,
		MinWidth:  720,
		MinHeight: 420,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 24, G: 26, B: 31, A: 1},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
		},
		StartHidden: startHidden(),
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               "hopline-7c2f1e9a-5b3d-4e8a-9f61-2d4c8b0a1e37",
			OnSecondInstanceLaunch: func(options.SecondInstanceData) { app.ShowWindow() },
		},
		OnStartup:     app.startup,
		OnShutdown:    app.shutdown,
		OnBeforeClose: app.beforeClose,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
