const { defineStore } = Pinia

const useStore = defineStore('store', {
  state() {
    return {
      map: L.map("map", {
        zoomControl: false, // Disable the default zoom control
      }),
      currentLayer: null,
      transmitter: {
        tx_lat: 51.102167,
        tx_lon: -114.098667,
        tx_power: 0.1,
        tx_freq: 905.0,
        tx_height: 1.0,
        tx_gain: 2.0
      },
      receiver: {
        rx_sensitivity: -130.0,
        rx_height: 1.0,
        rx_gain: 2.0,
        rx_loss: 2.0
      },
      environment: {
        radio_climate: 'continental_temperate',
        polarization: 'vertical',
        clutter_height: 0.0,
        ground_dielectric: 15.0,
        ground_conductivity: 0.005,
        atmosphere_bending: 301.0
      },
      simulation: {
        situation_fraction: 90.0,
        time_fraction: 90.0,
        simulation_extent: 10.0,
        high_resolution: false
      },
      output: {
        color_scale: 'plasma',
        min_dbm: -130.0,
        max_dbm: -80.0,
        overlay_transparency: 50
      }
    }
  },
  actions: {
    setTxCoords(lat, lon) {
      this.transmitter.tx_lat = lat
      this.transmitter.tx_lon = lon
    },
    initMap() {      
      this.map.setView([51.102167, -114.098667], 10);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap contributors",
      }).addTo(this.map);
      
      L.control.zoom({ position: "topleft" }).addTo(this.map);
      
      L.control
        .locate({
          position: "topleft",
        })
        .addTo(this.map);
    },
    async runSimulation() {
      console.log('Simulation running...')
      try {
        // Collect input values
        const payload = {
          // Transmitter parameters
          lat: this.transmitter.tx_lat,
          lon: this.transmitter.tx_lon,
          tx_height: this.transmitter.tx_height,
          tx_power: 10 * Math.log10(this.transmitter.tx_power) + 30,
          tx_gain: this.transmitter.tx_gain,
          frequency_mhz: this.transmitter.tx_freq,

          // Receiver parameters
          rx_height: this.receiver.rx_height,
          rx_gain: this.receiver.rx_gain,
          signal_threshold: this.receiver.rx_sensitivity,

          // Environment parameters
          clutter_height: this.environment.clutter_height,
          ground_dielectric: this.environment.ground_dielectric,
          ground_conductivity: this.environment.ground_conductivity,
          atmosphere_bending: this.environment.atmosphere_bending,
          radio_climate: this.environment.radio_climate,
          polarization: this.environment.polarization,

          // Simulation parameters
          radius: this.simulation.simulation_extent * 1000,
          system_loss: 0.0,
          situation_fraction: this.simulation.situation_fraction,
          time_fraction: this.simulation.time_fraction,
          high_resolution: this.simulation.high_resolution,

          // Output parameters
          colormap: this.output.color_scale,
          min_dbm: this.output.min_dbm,
          max_dbm: this.output.max_dbm,
        };
    
        console.log("Payload:", payload);
    
        // Send the request to the backend's /predict endpoint
        const predictResponse = await fetch("http://localhost:8000/predict", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
    
        if (!predictResponse.ok) {
          const errorDetails = await predictResponse.text();
          throw new Error(`Failed to start prediction: ${errorDetails}`);
        }
    
        const predictData = await predictResponse.json();
        const taskId = predictData.task_id;
    
        console.log(`Prediction started with task ID: ${taskId}`);
    
        // Poll for task status and result
        const pollInterval = 1000; // 1 seconds
        const pollStatus = async () => {
          const statusResponse = await fetch(
            `http://localhost:8000/status/${taskId}`,
          );
          if (!statusResponse.ok) {
            throw new Error("Failed to fetch task status.");
          }
    
          const statusData = await statusResponse.json();
          console.log("Task status:", statusData);
    
          if (statusData.status === "completed") {
            console.log("Simulation completed! Adding result to the map...");
    
            // Fetch the GeoTIFF data
            const resultResponse = await fetch(
              `http://localhost:8000/result/${taskId}`,
            );
            if (!resultResponse.ok) {
              throw new Error("Failed to fetch simulation result.");
            }
            const arrayBuffer = await resultResponse.arrayBuffer();
            // Use georaster-layer-for-leaflet to display the GeoTIFF
            const georaster = await parseGeoraster(arrayBuffer);
            // Remove the layer if it exists
            if (this.currentLayer) {
              this.map.removeLayer(this.currentLayer);
            }
            // Add the new layer to the map
            this.currentLayer = new GeoRasterLayer({
              georaster: georaster,
              opacity: 0.7,
              noDataValue: 255,
            });
            this.currentLayer.addTo(this.map);
          } 
          else if (statusData.status === "failed") {
            console.error("Simulation failed!");
          } else {
            setTimeout(pollStatus, pollInterval); // Retry after interval
          }
        };
    
        pollStatus(); // Start polling
      } catch (error) {
        console.error("Error:", error);
      }
    }
  }
});

export { useStore }