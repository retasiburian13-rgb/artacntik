import { useState, useEffect, useRef, useCallback } from "react";
import { LogEntry, AppState } from "./types";
import { Mic, MicOff, Thermometer, Droplets, Power, Activity, Wifi, WifiOff, Settings, AlertCircle } from "lucide-react";
import type { MqttClient } from "mqtt";

const mqtt = (window as any).mqtt;

export default function App() {
  const [flespiTokenInput, setFlespiTokenInput] = useState("");
  const [activeFlespiToken, setActiveFlespiToken] = useState("");

  const [connected, setConnected] = useState({
    mosquitto: false,
    flespi: false,
    mosquittoAuth: false,
  });

  const [state, setState] = useState<AppState>({
    temperature: null,
    humidity: null,
    relays: { 1: false, 2: false, 3: false, 4: false },
    patterns: { 1: false, 2: false },
  });

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [lastCommand, setLastCommand] = useState("");

  const logsEndRef = useRef<HTMLDivElement>(null);

  // MQTT Clients
  const clientMosquitto = useRef<MqttClient | null>(null);
  const clientFlespi = useRef<MqttClient | null>(null);
  const clientMosqAuth = useRef<MqttClient | null>(null);

  const synthesis = window.speechSynthesis;
  // @ts-ignore
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = useRef<any>(null);

  const addLog = useCallback((source: LogEntry["source"], message: string) => {
    setLogs((prev) => [...prev, { id: Math.random().toString(36).substring(7), source, message, timestamp: new Date() }]);
  }, []);

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  // Connect to Brokers
  useEffect(() => {
    // 1. Mosquitto Public
    const clientId1 = "dashboard_mosq_" + Math.random().toString(16).substring(2, 8);
    clientMosquitto.current = mqtt.connect("wss://test.mosquitto.org:8081/mqtt", {
      clientId: clientId1,
      clean: true,
      protocolVersion: 4
    });

    clientMosquitto.current.on("connect", () => {
      setConnected((p) => ({ ...p, mosquitto: true }));
      clientMosquitto.current?.subscribe("iot/sensor/suhu", { qos: 0 });
      clientMosquitto.current?.subscribe("iot/sensor/kelembapan", { qos: 0 });
      addLog("system", "Terhubung ke Mosquitto (Public)");
    });

    clientMosquitto.current.on("close", () => setConnected((p) => ({ ...p, mosquitto: false })));

    // 3. Mosquitto Auth
    const clientId3 = "dashboard_mosqauth_" + Math.random().toString(16).substring(2, 8);
    clientMosqAuth.current = mqtt.connect("wss://test.mosquitto.org:8081/mqtt", {
      clientId: clientId3,
      username: "rw",
      password: "readwrite",
      clean: true,
      protocolVersion: 4
    });

    clientMosqAuth.current.on("connect", () => {
      setConnected((p) => ({ ...p, mosquittoAuth: true }));
      clientMosqAuth.current?.subscribe("iot/sensor/suhu", { qos: 0 });
      clientMosqAuth.current?.subscribe("iot/sensor/kelembapan", { qos: 0 });
      addLog("system", "Terhubung ke Mosquitto (Auth)");
    });

    clientMosqAuth.current.on("close", () => setConnected((p) => ({ ...p, mosquittoAuth: false })));

    return () => {
      clientMosquitto.current?.end();
      clientMosqAuth.current?.end();
    };
  }, [addLog]);

  // Flespi connecting
  useEffect(() => {
    if (!activeFlespiToken) return;

    const clientId2 = "dashboard_flespi_" + Math.random().toString(16).substring(2, 8);
    clientFlespi.current = mqtt.connect("wss://mqtt.flespi.io", { // wss is usually required, prompt says ws port 80 but wss is port 443. I will try both or stick to standard wss if it fails. Let's use wss to be safe in browser. Flespi uses port 443 for wss.
      clientId: clientId2,
      username: activeFlespiToken,
      password: "",
      clean: true,
      protocolVersion: 4
    });

    clientFlespi.current.on("connect", () => {
      setConnected((p) => ({ ...p, flespi: true }));
      clientFlespi.current?.subscribe("iot/sensor/suhu", { qos: 0 });
      clientFlespi.current?.subscribe("iot/sensor/kelembapan", { qos: 0 });
      addLog("system", "Terhubung ke Flespi");
    });

    clientFlespi.current.on("error", (err) => {
        addLog("system", `Flespi error: ${err.message}`);
    });

    clientFlespi.current.on("close", () => setConnected((p) => ({ ...p, flespi: false })));

    return () => {
      clientFlespi.current?.end();
    };
  }, [activeFlespiToken, addLog]);

  // Handle incoming messages
  useEffect(() => {
    const handleMessage = (topic: string, message: any) => {
      let payloadText = "";
      if (typeof message === "string") {
        payloadText = message;
      } else if (message instanceof Uint8Array) {
        payloadText = new TextDecoder().decode(message);
      } else if (message && message.toString) {
        payloadText = message.toString();
      }
      
      const val = parseFloat(payloadText);
      if (isNaN(val)) return;

      if (topic === "iot/sensor/suhu") {
        setState((p) => ({ ...p, temperature: val }));
      } else if (topic === "iot/sensor/kelembapan") {
        setState((p) => ({ ...p, humidity: val }));
      }
    };

    if (clientMosquitto.current) clientMosquitto.current.on("message", handleMessage);
    if (clientMosqAuth.current) clientMosqAuth.current.on("message", handleMessage);
    if (clientFlespi.current) clientFlespi.current.on("message", handleMessage);

    return () => {
      if (clientMosquitto.current) clientMosquitto.current.off("message", handleMessage);
      if (clientMosqAuth.current) clientMosqAuth.current.off("message", handleMessage);
      if (clientFlespi.current) clientFlespi.current.off("message", handleMessage);
    };
  }, []);

  const publishToAll = useCallback((topic: string, payload: string) => {
    [clientMosquitto, clientFlespi, clientMosqAuth].forEach((client) => {
      if (client.current?.connected) {
        client.current.publish(topic, payload, { qos: 0 });
      }
    });
    addLog("send", `[${topic}] ${payload}`);
  }, [addLog]);

  const toggleRelay = (id: 1 | 2 | 3 | 4) => {
    const isPatternActive = state.patterns[1] || state.patterns[2];
    if (isPatternActive) return;

    const nextState = !state.relays[id];
    setState((p) => ({ ...p, relays: { ...p.relays, [id]: nextState } }));
    publishToAll(`iot/relay/${id}`, nextState ? "ON" : "OFF");
  };

  const togglePattern = (id: 1 | 2) => {
    const nextState = !state.patterns[id];
    
    setState((p) => {
      // IF turning ON, turn off the other pattern
      const nextPatterns = { ...p.patterns, [id]: nextState };
      if (nextState) {
        const other = id === 1 ? 2 : 1;
        if (p.patterns[other]) {
           publishToAll(`iot/pola/${other}`, "OFF");
        }
        nextPatterns[other] = false;
      }
      return { ...p, patterns: nextPatterns };
    });
    
    publishToAll(`iot/pola/${id}`, nextState ? "ON" : "OFF");
  };
  
  const speakText = (text: string) => {
    if (!synthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "id-ID";
    synthesis.speak(utterance);
  };

  // Voice Command Setup
  useEffect(() => {
    if (!SpeechRecognition) return;

    recognition.current = new SpeechRecognition();
    recognition.current.continuous = true;
    recognition.current.lang = "id-ID";
    recognition.current.interimResults = false;

    recognition.current.onstart = () => setIsListening(true);
    recognition.current.onend = () => setIsListening(false);
    recognition.current.onerror = (e: any) => {
      console.error(e);
      setIsListening(false);
    };

    recognition.current.onresult = (e: any) => {
      const transcript = e.results[e.results.length - 1][0].transcript.toLowerCase().trim();
      setLastCommand(transcript);
      addLog("voice", transcript);
      
      let matched = false;

      // Match logic
      if (transcript.includes("sensor") || transcript.includes("suhu") || transcript.includes("kelembapan")) {
         matched = true;
         const currentTemp = state.temperature ?? 0;
         const currentHum = state.humidity ?? 0;
         const speech = `Suhu saat ini ${currentTemp} derajat celcius, kelembapan saat ini ${currentHum} persen`;
         speakText(speech);
         addLog("system", speech);
      } 
      // Relays
      else if (transcript.includes("nyala") || transcript.includes("hidup") || transcript.includes("on")) {
         if (transcript.includes("relay satu")) { toggleRelay(1); speakText("Relay satu dinyalakan"); matched = true; }
         else if (transcript.includes("relay dua")) { toggleRelay(2); speakText("Relay dua dinyalakan"); matched = true;}
         else if (transcript.includes("relay tiga")) { toggleRelay(3); speakText("Relay tiga dinyalakan"); matched = true;}
         else if (transcript.includes("relay empat")) { toggleRelay(4); speakText("Relay empat dinyalakan"); matched = true;}
         else if (transcript.includes("pola satu")) { togglePattern(1); speakText("Pola satu dinyalakan"); matched = true;}
         else if (transcript.includes("pola dua")) { togglePattern(2); speakText("Pola dua dinyalakan"); matched = true;}
      }
      // Off
      else if (transcript.includes("mati") || transcript.includes("stop") || transcript.includes("off")) {
         if (transcript.includes("relay satu")) { toggleRelay(1); speakText("Relay satu dimatikan"); matched = true; }
         else if (transcript.includes("relay dua")) { toggleRelay(2); speakText("Relay dua dimatikan"); matched = true;}
         else if (transcript.includes("relay tiga")) { toggleRelay(3); speakText("Relay tiga dimatikan"); matched = true;}
         else if (transcript.includes("relay empat")) { toggleRelay(4); speakText("Relay empat dimatikan"); matched = true;}
         else if (transcript.includes("semua pola")) { 
             if (state.patterns[1]) togglePattern(1);
             if (state.patterns[2]) togglePattern(2);
             speakText("Semua pola dimatikan");
             matched = true;
         }
         else if (transcript.includes("pola satu")) { togglePattern(1); speakText("Pola satu dimatikan"); matched = true;}
         else if (transcript.includes("pola dua")) { togglePattern(2); speakText("Pola dua dimatikan"); matched = true;}
      }

      if (!matched && !!transcript) {
         addLog("system", "Perintah suara tidak dikenali: " + transcript);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, addLog]);

  const toggleListening = () => {
    if (!SpeechRecognition) return alert("Browser Anda tidak mendukung Voice Command Web API");
    if (isListening) {
      recognition.current?.stop();
    } else {
      recognition.current?.start();
    }
  };

  // The setup screen for Flespi Token was removed by request


  const isPatternActive = state.patterns[1] || state.patterns[2];

  return (
    <div className="flex flex-col h-screen w-full bg-[#09090b] text-white p-4 md:p-6 font-sans overflow-hidden">
      {/* HEADER */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 h-auto sm:h-12 flex-shrink-0 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-r from-pink-500 to-red-500 rounded-lg flex items-center justify-center">
            <Settings className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight uppercase">
            IoT Dashboard <span className="text-[#f43f5e] text-sm opacity-60 ml-2 hidden sm:inline-block">V.2.0</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <input 
            type="password"
            placeholder="Token Flespi..."
            value={flespiTokenInput}
            onChange={(e) => setFlespiTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setActiveFlespiToken(flespiTokenInput)}
            className="bg-zinc-900/50 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#f43f5e] transition-colors w-32 sm:w-56"
          />
          <button 
            onClick={() => setActiveFlespiToken(flespiTokenInput)}
            className="bg-zinc-800 hover:bg-zinc-700 text-xs font-bold text-zinc-300 px-3 py-2 rounded-lg transition-colors border border-zinc-700"
          >
            Connect
          </button>
        </div>
      </header>

      {/* MAIN BENTO GRID */}
      <div className="flex-grow overflow-y-auto md:overflow-hidden custom-scrollbar pb-8 md:pb-0">
        <div className="grid grid-cols-1 md:grid-cols-12 md:grid-rows-6 gap-4 h-auto md:h-full">
          
          {/* CONNECTION STATUS (Left Top) */}
          <div className="md:col-span-3 md:row-span-2 bg-[#18181b] border border-zinc-800 rounded-2xl p-5 flex flex-col justify-between">
            <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 md:mb-0">MQTT Broker Status</h2>
            <div className="space-y-3 overflow-y-auto pr-1 custom-scrollbar">
              <BrokerStatus name="Mosquitto Public" connected={connected.mosquitto} />
              <BrokerStatus name="Flespi Cloud" connected={connected.flespi} />
              <BrokerStatus name="Mosquitto Auth" connected={connected.mosquittoAuth} />
            </div>
          </div>

          {/* SENSOR PANEL (Center Top) */}
          <div className="md:col-span-6 md:row-span-3 bg-[#18181b] border border-zinc-800 rounded-2xl p-5 md:p-6 flex flex-col">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Real-time Telemetry</h2>
              <span className="px-2 py-1 bg-[#f43f5e]/10 text-[#f43f5e] text-[10px] rounded font-bold">LIVE DATA</span>
            </div>
            <div className="grid grid-cols-2 gap-4 flex-grow">
              <div className="bg-zinc-900/40 rounded-2xl md:rounded-3xl border border-zinc-800/50 flex flex-col items-center justify-center relative overflow-hidden group p-4">
                <div className="absolute top-0 right-0 p-3 md:p-4 opacity-10">
                  <Thermometer className="w-10 h-10 md:w-16 md:h-16" />
                </div>
                <span className="text-xs md:text-sm text-zinc-400 font-medium mb-1 md:mb-2 text-center">Temperatur</span>
                <div className="flex items-baseline z-10" key={state.temperature}>
                  <span className="text-4xl sm:text-5xl md:text-7xl font-light text-[#f43f5e] tracking-tighter animate-pulse-orange">
                    {state.temperature ?? "--"}
                  </span>
                  <span className="text-lg md:text-2xl text-[#f43f5e] ml-1">°C</span>
                </div>
              </div>
              <div className="bg-zinc-900/40 rounded-2xl md:rounded-3xl border border-zinc-800/50 flex flex-col items-center justify-center relative overflow-hidden group p-4">
                <div className="absolute top-0 right-0 p-3 md:p-4 opacity-10">
                  <Droplets className="w-10 h-10 md:w-16 md:h-16" />
                </div>
                <span className="text-xs md:text-sm text-zinc-400 font-medium mb-1 md:mb-2 text-center">Kelembapan</span>
                <div className="flex items-baseline z-10" key={state.humidity + "h"}>
                  <span className="text-4xl sm:text-5xl md:text-7xl font-light text-[#f43f5e] tracking-tighter animate-pulse-orange">
                    {state.humidity ?? "--"}
                  </span>
                  <span className="text-lg md:text-2xl text-[#f43f5e] ml-1">%</span>
                </div>
              </div>
            </div>
          </div>

          {/* RELAY CONTROL (Right Top) */}
          <div className="md:col-span-3 md:row-span-3 bg-[#18181b] border border-zinc-800 rounded-2xl p-5 flex flex-col h-[280px] md:h-auto">
            <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">Relay Control</h2>
            <div className="grid grid-cols-2 gap-3 md:gap-4 flex-grow">
              {[1, 2, 3, 4].map((id) => (
                <button
                  key={id}
                  disabled={isPatternActive}
                  onClick={() => toggleRelay(id as 1 | 2 | 3 | 4)}
                  className={`flex flex-col items-center justify-center gap-1 md:gap-2 rounded-2xl transition-all ${
                    state.relays[id as 1 | 2 | 3 | 4]
                      ? "bg-gradient-to-br from-pink-500 to-red-500 text-white shadow-[0_0_15px_rgba(244,63,94,0.4)]"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  } ${isPatternActive ? "opacity-30 cursor-not-allowed" : ""}`}
                >
                  <span className="text-[10px] font-bold uppercase">Relay {id}</span>
                  <span className="text-xl md:text-2xl font-bold">{state.relays[id as 1 | 2 | 3 | 4] ? "ON" : "OFF"}</span>
                </button>
              ))}
            </div>
          </div>

          {/* LOG AKTIVITAS (Left Bottom) */}
          <div className="md:col-span-3 md:row-span-4 bg-[#18181b] border border-zinc-800 rounded-2xl p-5 flex flex-col overflow-hidden h-[300px] md:h-auto">
            <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4 shrink-0">Log Aktivitas</h2>
            <div className="flex-grow space-y-2 md:space-y-3 font-mono text-[10px] overflow-y-auto pr-2 custom-scrollbar">
              {logs.length === 0 && <div className="text-zinc-600 italic">Belum ada aktivitas...</div>}
              {logs.map((log) => {
                const isSend = log.source === "send";
                const isVoice = log.source === "voice";
                const isSys = log.source === "system";

                let borderColor = "border-zinc-700";
                let bgColor = "";
                let textColor = "text-zinc-200";
                let prefix = "SYS:";

                if (isSend) { borderColor = "border-[#f43f5e]"; bgColor = "bg-zinc-900/30"; textColor = "text-zinc-200"; prefix = "PUB:"; }
                else if (isVoice) { borderColor = "border-purple-500"; bgColor = "bg-purple-900/10"; textColor = "text-purple-200"; prefix = "VOX:"; }
                else if (isSys) { prefix = "EVT:"; }

                return (
                  <div key={log.id} className={`border-l-2 ${borderColor} pl-2 py-1 ${bgColor}`}>
                    <p className="text-zinc-500 opacity-80">{log.timestamp.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
                    <p className={`${textColor} break-words`}><span className="font-semibold opacity-70 mr-1">{prefix}</span>{log.message}</p>
                  </div>
                );
              })}
              <div ref={logsEndRef} />
            </div>
          </div>

          {/* VOICE CONTROL (Center Bottom) */}
          <div className="md:col-span-6 md:row-span-3 bg-[#18181b] border border-zinc-800 rounded-2xl p-6 flex flex-col md:flex-row items-center gap-6 justify-center">
            <button
               onClick={toggleListening}
               className={`w-28 h-28 md:w-32 md:h-32 rounded-full flex items-center justify-center relative shrink-0 transition-all ${
                  isListening
                    ? "bg-gradient-to-br from-pink-500/20 to-red-500/20 border-4 border-pink-500"
                    : "bg-zinc-800 border-2 border-zinc-700 hover:border-zinc-500"
               }`}
            >
               {isListening && <div className="absolute inset-0 rounded-full bg-pink-500 animate-ping opacity-20"></div>}
               {isListening ? <Mic className="w-12 h-12 text-pink-500" /> : <MicOff className="w-10 h-10 text-zinc-500" />}
            </button>
            <div className="flex-grow w-full text-center md:text-left flex flex-col justify-center">
               <h2 className={`text-xs font-bold uppercase tracking-widest mb-1 md:mb-2 ${isListening ? "text-[#f43f5e]" : "text-zinc-500"}`}>
                   {isListening ? "Voice Command Active" : "Voice Command Inactive"}
               </h2>
               <p className="text-lg md:text-2xl font-semibold tracking-tight leading-tight mb-2 md:mb-3 italic text-white line-clamp-2 min-h-[32px] md:min-h-[56px] flex items-center justify-center md:justify-start">
                  {lastCommand ? `"${lastCommand}"` : (isListening ? '"Mendengarkan..."' : "Ketuk mikrofon")}
               </p>
               <div className="h-[2px] bg-zinc-800 w-full mb-3 overflow-hidden rounded">
                 {isListening && <div className="h-full bg-[#f43f5e] w-full animate-pulse-orange"></div>}
               </div>
               <p className="text-xs md:text-sm text-zinc-500 line-clamp-1">
                  Status: <span className={lastCommand ? "text-[#f43f5e]" : "text-zinc-400"}>
                    {logs.slice().reverse().find(l => l.source === 'system' && l.timestamp > new Date(Date.now() - 5000))?.message || "Siap menerima perintah..."}
                  </span>
               </p>
            </div>
          </div>

          {/* POLA LAMPU (Right Bottom) */}
          <div className="md:col-span-3 md:row-span-3 bg-[#18181b] border border-zinc-800 rounded-2xl p-5 flex flex-col h-[280px] md:h-auto">
            <h2 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-4">Pola Lampu</h2>
            <div className="flex flex-col gap-3 flex-grow justify-center">
                <button
                  onClick={() => togglePattern(1)}
                  className={`w-full py-4 md:py-5 px-4 border rounded-xl flex items-center gap-4 transition-all ${
                    state.patterns[1]
                      ? "bg-[#f43f5e]/10 border-[#f43f5e]/30"
                      : "bg-zinc-800/80 border-zinc-700 hover:border-zinc-500"
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full shrink-0 ${state.patterns[1] ? "bg-[#f43f5e] shadow-[0_0_8px_#f43f5e]" : "bg-zinc-600"}`}></div>
                  <div className="text-left leading-tight">
                    <p className={`text-xs font-bold ${state.patterns[1] ? "text-[#f43f5e]" : "text-zinc-300"}`}>POLA 01</p>
                    <p className={`text-[10px] uppercase mt-0.5 ${state.patterns[1] ? "text-[#f43f5e]/70" : "text-zinc-500"}`}>Kiri ke Kanan</p>
                  </div>
                </button>
                <button
                  onClick={() => togglePattern(2)}
                  className={`w-full py-4 md:py-5 px-4 border rounded-xl flex items-center gap-4 transition-all ${
                    state.patterns[2]
                      ? "bg-[#f43f5e]/10 border-[#f43f5e]/30"
                      : "bg-zinc-800/80 border-zinc-700 hover:border-zinc-500"
                  }`}
                >
                  <div className={`w-3 h-3 rounded-full shrink-0 ${state.patterns[2] ? "bg-[#f43f5e] shadow-[0_0_8px_#f43f5e]" : "bg-zinc-600"}`}></div>
                  <div className="text-left leading-tight">
                    <p className={`text-xs font-bold ${state.patterns[2] ? "text-[#f43f5e]" : "text-zinc-300"}`}>POLA 02</p>
                    <p className={`text-[10px] uppercase mt-0.5 ${state.patterns[2] ? "text-[#f43f5e]/70" : "text-zinc-500"}`}>Strobe Effect</p>
                  </div>
                </button>

                <div className={`mt-auto p-3 rounded-lg border transition-opacity duration-300 ${isPatternActive ? "bg-red-950/20 border-red-900/30 opacity-100" : "opacity-0 pointer-events-none hidden md:block"}`}>
                   <p className="text-[10px] text-red-500 leading-tight uppercase font-bold flex items-start">
                      <AlertCircle className="w-3 h-3 inline mr-1.5 shrink-0 mt-0.5" />
                      Relay Individual Dinonaktifkan Saat Pola Aktif
                   </p>
                </div>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}

function BrokerStatus({ name, connected }: { name: string; connected: boolean }) {
  return (
    <div className="flex items-center justify-between p-2 md:p-3 rounded-xl bg-zinc-900/50 min-h-[44px]">
      <span className="text-sm text-zinc-300">{name}</span>
      <div className="flex items-center gap-2">
         <span className={`text-[10px] font-mono ${connected ? 'text-green-400' : 'text-red-400'}`}>
            {connected ? 'CONNECTED' : 'DISCONNECTED'}
         </span>
         <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`}></div>
      </div>
    </div>
  );
}

