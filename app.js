const { createApp, ref, computed, watch, onMounted, nextTick } = Vue;

const generateUid = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

createApp({
    setup() {
        const currentTab = ref('dashboard');
        const isSidebarOpen = ref(true); // Control de Menú Retráctil
        const syncStatus = ref('');
        const ipinfoToken = '8c97cc52a98a48'; 
        
        const accounts = ref([]);
        const accountSearch = ref('');
        const accountSort = ref({ field: null, desc: false });
        
        const pool = ref([]);
        const poolFilters = ref({ nodeId: '', isp: '', city: '', minQuality: '2.5' });
        const poolSort = ref({ field: null, desc: false });
        const isFetchingPool = ref(false); // evita que clics repetidos disparen varias extracciones al mismo tiempo

        const blacklist = ref([]);
        const bulkBlacklistText = ref('');
        const showBulkLoadModal = ref(false);
        const bulkLoadText = ref('');

        const showAccountSelectModal = ref(false);
        const nodeToAssign = ref('');

        let chartInstance = null;

        const toggleSidebar = () => {
            isSidebarOpen.value = !isSidebarOpen.value;
            // Se fuerza el redibujado de las gráficas al colapsar el menú para que se ajusten
            setTimeout(() => { updateCharts(); }, 350); 
        };

        const saveData = () => {
            localStorage.setItem('vpn_nexus_acc', JSON.stringify(accounts.value));
            localStorage.setItem('vpn_nexus_blk', JSON.stringify(blacklist.value));
            localStorage.setItem('vpn_nexus_pool', JSON.stringify(pool.value)); 
            updateCharts();
        };

        const loadData = () => {
            let savedAcc = JSON.parse(localStorage.getItem('vpn_nexus_acc'));
            let savedBlk = JSON.parse(localStorage.getItem('vpn_nexus_blk'));
            let savedPool = JSON.parse(localStorage.getItem('vpn_nexus_pool')); 

            if (savedAcc && savedAcc.length > 0) {
                accounts.value = savedAcc.map(a => ({
                    ...a,
                    county: a.county || 'Desconocido',
                    previousIp: a.previousIp || null
                }));
            }
            blacklist.value = savedBlk || [];
            if (savedPool && savedPool.length > 0) {
                pool.value = savedPool; 
            }
        };

        watch([accounts, blacklist, pool], saveData, { deep: true });

        const processBulkLoad = () => {
            if (!bulkLoadText.value.trim()) return;
            const lineas = bulkLoadText.value.trim().split('\n');
            let nuevasCuentas = [];
            lineas.forEach(linea => {
                const partes = linea.trim().split(/\s+/);
                if (partes.length >= 2) {
                    nuevasCuentas.push({
                        uid: generateUid(),
                        name: partes[0],
                        fecha: partes[1],
                        nodeId: partes.length >= 3 ? partes[2] : "",
                        ip: partes.length >= 4 ? partes[3] : "",
                        isp: 'Desconocido',
                        county: 'Desconocido',
                        previousIp: null
                    });
                }
            });
            accounts.value = nuevasCuentas;
            showBulkLoadModal.value = false;
            bulkLoadText.value = '';
            showStatus(`¡Cargadas ${nuevasCuentas.length} cuentas! Iniciando escáner...`);
            reinitIcons();
            forceEnrichmentSweep();
        };

        // --- ENRIQUECIMIENTO INTELIGENTE (NOMINATIM + IPINFO) ---
        const fetchSingleISP = async (acc) => {
            if (!acc.ip || acc.ip === '0.0.0.0' || !acc.ip.includes('.')) return;
            try {
                const res = await fetch(`https://ipinfo.io/${acc.ip}/json?token=${ipinfoToken}`);
                if (res.ok) {
                    const data = await res.json();
                    let org = data.org || 'Desconocido';
                    acc.isp = org.replace(/^AS\d+\s/, '').trim();
                    
                    // EXTRAER REGIÓN LOCAL CON NOMINATIM
                    if (data.loc) {
                        const [lat, lon] = data.loc.split(',');
                        try {
                            const nomRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
                            const nomData = await nomRes.json();
                            if (nomData && nomData.address) {
                                // Buscar el mejor nivel territorial (Ignorando nombres de país)
                                let div = nomData.address.state_district || nomData.address.county || nomData.address.city || data.city;
                                const ignorar = ['england', 'scotland', 'wales', 'northern ireland', 'united kingdom', 'uk', 'great britain'];
                                
                                if (div && ignorar.includes(div.toLowerCase())) {
                                    div = nomData.address.city || nomData.address.town || nomData.address.municipality || data.city || 'Desconocida';
                                }
                                
                                // Ajuste específico para Londres
                                if (div.toLowerCase() === 'london' && nomData.address.state_district) {
                                    div = nomData.address.state_district; // Suele traer "Greater London"
                                }

                                acc.county = div;
                            } else {
                                acc.county = data.city || data.region || 'Desconocido';
                            }
                        } catch (e) {
                            acc.county = data.city || data.region || 'Desconocido';
                        }
                    } else {
                        acc.county = data.city || data.region || 'Desconocido';
                    }
                }
            } catch (error) {}
        };

        const forceEnrichmentSweep = async () => {
            syncStatus.value = 'Escaneando proveedores y regiones...';
            for (let acc of accounts.value) {
                if (acc.ip && acc.ip !== 'Pendiente' && (!acc.isp || acc.isp === 'Desconocido' || acc.county === 'England' || acc.county === 'Desconocido')) {
                    await fetchSingleISP(acc);
                    // Nominatim exige 1 segundo de pausa entre consultas para no bloquear tu IP (Hard Limit)
                    await new Promise(r => setTimeout(r, 1100)); 
                }
            }
            syncStatus.value = '¡Escaneo Completado!';
            setTimeout(() => { syncStatus.value = ''; }, 3000);
            updateCharts();
        };

        // --- SISTEMA ANTI-ERROR (RAYITO Y DESHACER) ---
        const autoDetectIP = async (acc) => {
            if (acc.ip && acc.ip !== '0.0.0.0' && acc.ip !== 'Pendiente') {
                const confirmed = confirm(`¿Aseguraste que el VPN de [${acc.name}] está encendido?\n\nEsto reemplazará la IP: ${acc.ip}`);
                if (!confirmed) return;
            }

            syncStatus.value = `Detectando red para ${acc.name}...`;
            try {
                const res = await fetch("https://api.ipify.org?format=json");
                const data = await res.json();
                
                acc.previousIp = acc.ip; 
                acc.ip = data.ip;
                
                await fetchSingleISP(acc);
                
                if (hasCollision(acc)) {
                    alert(`🚨 ¡ALERTA DE COLISIÓN! \nLa IP ${acc.ip} choca con otra cuenta (mismo bloque /24). Quema este nodo o usa el botón Deshacer (Giro hacia atrás) si fue un error.`);
                } else {
                    showStatus('IP Limpia. Conexión segura.');
                }
            } catch(e) {
                alert("Error detectando IP. Verifica tu conexión a internet.");
            }
            syncStatus.value = "";
            updateCharts();
        };

        const undoIp = async (acc) => {
            if (acc.previousIp) {
                acc.ip = acc.previousIp;
                acc.previousIp = null;
                showStatus('¡Se restauró la IP anterior por seguridad!');
                await fetchSingleISP(acc);
                updateCharts();
            }
        };

        const manualIPCheck = async (acc) => {
            if (acc.ip && acc.ip.includes('.')) {
                if (hasCollision(acc)) {
                    alert(`🚨 ¡ALERTA DE COLISIÓN! \nLa IP ${acc.ip} choca con otra cuenta activa.`);
                }
                await fetchSingleISP(acc);
                updateCharts();
            }
        };

        const addAccount = () => {
            const num = accounts.value.length + 1;
            accounts.value.push({ uid: generateUid(), name: `LON-${num < 10 ? '0'+num : num}`, fecha: '', nodeId: '', ip: '', isp: 'Desconocido', county: 'Desconocido', previousIp: null });
            reinitIcons();
        };
        const removeAccount = (uid) => { if(confirm("¿Eliminar fila completa?")) accounts.value = accounts.value.filter(a => a.uid !== uid); };

        // ¡NUEVA FUNCIÓN! Vacía la cuenta y manda el nodo a la cuarentena
        const burnNodeFromAccount = (uid) => {
            const acc = accounts.value.find(a => a.uid === uid);
            if(acc) {
                const nodeStr = (acc.nodeId || '').trim();
                let added = false;
                
                if(nodeStr && !blacklist.value.includes(nodeStr)) {
                    blacklist.value.unshift(nodeStr);
                    added = true;
                }
                
                if (added) showStatus(`Nodo ${nodeStr} enviado a cuarentena.`);
                
                // Vaciar los datos de la cuenta dejándola limpia
                acc.nodeId = '';
                acc.ip = '';
                acc.isp = 'Desconocido';
                acc.county = 'Desconocido';
                acc.previousIp = null;
                
                updateCharts();
            }
        };

        const hasCollision = (currentAccount) => {
            if ((!currentAccount.ip || currentAccount.ip === 'Pendiente') && !currentAccount.nodeId) return false;
            return accounts.value.some(acc => {
                if (acc.uid === currentAccount.uid) return false;
                
                const curNode = (currentAccount.nodeId || '').trim();
                const accNode = (acc.nodeId || '').trim();
                if (accNode !== '' && curNode !== '' && accNode === curNode) return true;

                const curIp = (currentAccount.ip || '').trim();
                const accIp = (acc.ip || '').trim();
                if (curIp && accIp && curIp !== 'Pendiente' && accIp !== 'Pendiente') {
                    const octCur = curIp.split('.');
                    const octAcc = accIp.split('.');
                    if (octCur.length === 4 && octAcc.length === 4) {
                        if (octCur[0] === octAcc[0] && octCur[1] === octAcc[1] && octCur[2] === octAcc[2]) return true; 
                    }
                }
                return false;
            });
        };
        const collisionCount = computed(() => accounts.value.filter(acc => hasCollision(acc)).length);

        const toggleAccountSort = (field) => {
            if (accountSort.value.field === field) accountSort.value.desc = !accountSort.value.desc;
            else { accountSort.value.field = field; accountSort.value.desc = false; }
            reinitIcons();
        };

        const processedAccounts = computed(() => {
            let result = accounts.value;
            if (accountSearch.value) {
                const s = accountSearch.value.toLowerCase().trim();
                result = result.filter(a => (a.name || '').toLowerCase().includes(s) || (a.nodeId || '').toLowerCase().includes(s) || (a.ip || '').toLowerCase().includes(s) || (a.isp || '').toLowerCase().includes(s) || (a.county || '').toLowerCase().includes(s));
            }
            if (accountSort.value.field) {
                result = [...result].sort((a, b) => {
                    let valA = (a[accountSort.value.field] || '').toLowerCase();
                    let valB = (b[accountSort.value.field] || '').toLowerCase();
                    if (valA < valB) return accountSort.value.desc ? 1 : -1;
                    if (valA > valB) return accountSort.value.desc ? -1 : 1;
                    return 0;
                });
            }
            return result;
        });

        // --- SISTEMA POOL CON MEMORIA TRIANGULADA ---
        // Solo se aceptan estas ISP (BT Broadband, sin EE/Plusnet; Sky Broadband; Virgin Media; TalkTalk)
        const ISP_PERMITIDAS = [/british telecommunications/i, /sky uk/i, /virgin media/i, /talktalk/i];
        const isIspPermitida = (isp) => ISP_PERMITIDAS.some(rx => rx.test(isp || ''));

        // Quita del pool cualquier nodo que ya estuviera guardado con una ISP fuera de la lista
        // (nodos que entraron antes de tener este filtro, por fetch viejo, JSON manual o respaldo)
        const purgeNonAllowedIsps = () => {
            const antes = pool.value.length;
            pool.value = pool.value.filter(n => isIspPermitida(n.asn_isp));
            const quitados = antes - pool.value.length;
            return quitados;
        };

        const processNodeData = (data) => {
            const currentPoolMap = new Map();
            pool.value.forEach(n => currentPoolMap.set(n.id, n));

            data.forEach(nodo => {
                if (!nodo.provider_id) return;
                const ispNombre = nodo.location?.isp || '';
                if (!isIspPermitida(ispNombre)) return; // descarta cualquier ISP fuera de la lista permitida

                const idCorto = nodo.provider_id.substring(0, 14);
                
                currentPoolMap.set(idCorto, {
                    id: idCorto,
                    city: nodo.location?.city || 'Desconocida',
                    asn_isp: `${nodo.location?.asn || ''} ${nodo.location?.isp || ''}`.trim(),
                    q_score: (nodo.quality?.quality || 0).toFixed(2)
                });
            });

            const rawPool = [];
            currentPoolMap.forEach(n => {
                if (!isIspPermitida(n.asn_isp)) return; // limpia también lo que ya estaba guardado de antes
                const isBlacklisted = blacklist.value.includes(n.id);
                const inUse = accounts.value.some(a => (a.nodeId || '').trim() === n.id);
                if (!isBlacklisted && !inUse) {
                    rawPool.push(n);
                }
            });

            pool.value = rawPool;
            showStatus(`Radar completado: ${pool.value.length} nodos limpios disponibles.`);
        };

        const fetchMysteriumAPI = async () => {
            if (isFetchingPool.value) return; // ignora clics repetidos mientras ya hay una extracción en curso
            isFetchingPool.value = true;
            syncStatus.value = 'Conectando a Mysterium...';
            const targetUrl = "https://discovery.mysterium.network/api/v3/proposals?location_country=GB&ip_type=residential";
            const failLog = [];

            // PASO 1 (vía garantizada): snapshot que guarda el GitHub Action cada 5 min
            // en data/nodes-gb.json. Mismo origen que la página -> nunca hay CORS aquí.
            // Sin límite de antigüedad: siempre que el archivo tenga nodos, se usa directo
            // (con el Action corriendo cada 5 min, nunca se aleja mucho de "en vivo").
            try {
                const localRes = await fetch(`data/nodes-gb.json?t=${Date.now()}`, { cache: 'no-store' });
                if (localRes.ok) {
                    const localParsed = JSON.parse(await localRes.text());
                    const nodos = Array.isArray(localParsed) ? localParsed : localParsed.nodes; // compat. formato viejo
                    const fetchedAt = localParsed.fetched_at ? new Date(localParsed.fetched_at) : null;
                    const minutosAtras = fetchedAt ? Math.round((Date.now() - fetchedAt.getTime()) / 60000) : null;

                    if (Array.isArray(nodos) && nodos.length > 0 && nodos[0].provider_id) {
                        console.log(`¡Éxito usando: snapshot local (hace ${minutosAtras ?? '?'} min)!`);
                        processNodeData(nodos);
                        showStatus(`Nodos actualizados (hace ${minutosAtras ?? 0} min).`);
                        isFetchingPool.value = false;
                        setTimeout(() => { syncStatus.value = ''; }, 4000);
                        return;
                    } else {
                        failLog.push('Snapshot local: vacío todavía');
                    }
                } else {
                    failLog.push('Snapshot local: aún no existe (corre el Action una vez desde la pestaña Actions de GitHub)');
                }
            } catch (e) {
                failLog.push(`Snapshot local: ${e.message}`);
            }


            // PASO 2 (respaldo en vivo): si el snapshot no sirvió, prueba proxies en paralelo.
            // NOTA: corsproxy.io restringió su plan gratuito solo a "localhost" en 2026,
            // por eso se dejó de último. Cada intento tiene timeout propio para que uno
            // caído no frene a los demás.
            syncStatus.value = 'Snapshot no disponible, probando proxies en vivo...';
            const attempts = [
                { name: 'AllOrigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}` },
                { name: 'CodeTabs', url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}` },
                { name: 'Corsfix', url: `https://proxy.corsfix.com/?${targetUrl}` },
                { name: 'CorsX2U', url: `https://cors.x2u.in/${targetUrl}` },
                { name: 'ThingProxy', url: `https://thingproxy.freeboard.io/fetch/${targetUrl}` },
                { name: 'CorsProxy.io (fallback)', url: `https://corsproxy.io/?url=${encodeURIComponent(targetUrl)}` }
            ];

            const tryAttempt = async (attempt) => {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 9000);
                try {
                    const res = await fetch(attempt.url, {
                        headers: { 'Accept': 'application/json' },
                        cache: 'no-store',
                        signal: controller.signal
                    });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const text = await res.text();
                    const parsed = JSON.parse(text);
                    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].provider_id) {
                        console.log(`¡Éxito usando: ${attempt.name}!`);
                        return parsed;
                    }
                    throw new Error('Respuesta sin nodos válidos');
                } catch (e) {
                    failLog.push(`${attempt.name}: ${e.name === 'AbortError' ? 'Timeout' : e.message}`);
                    throw e;
                } finally {
                    clearTimeout(timeout);
                }
            };

            let data = null;
            try {
                data = await Promise.any(attempts.map(tryAttempt));
            } catch (aggregateError) {
                data = null;
            }

            if (data && Array.isArray(data)) {
                processNodeData(data);
            } else {
                console.warn('Fallos detallados:', failLog);
                alert(`🚫 ERROR: Ni el snapshot ni los proxies lograron la conexión.\n\nDetalle:\n${failLog.join('\n')}\n\nUsa el botón verde 'Subir JSON Manual' mientras tanto.`);
                syncStatus.value = 'Error de conexión.';
            }
            isFetchingPool.value = false;
            setTimeout(() => { syncStatus.value = ''; }, 4000);
        };

        const importPoolJSON = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (Array.isArray(data)) {
                        processNodeData(data);
                        showStatus('JSON Manual añadido al pool exitosamente sin borrar los anteriores.');
                    } else if (data.contents) {
                        processNodeData(JSON.parse(data.contents));
                        showStatus('JSON Manual añadido al pool exitosamente.');
                    } else {
                        throw new Error("Formato inválido");
                    }
                } catch (err) {
                    alert("🚫 Error al leer el archivo JSON.");
                }
                event.target.value = null; 
            };
            reader.readAsText(file);
        };

        const burnDirectlyFromPool = (nodeId) => {
            if (!blacklist.value.includes(nodeId)) {
                blacklist.value.unshift(nodeId);
                pool.value = pool.value.filter(n => n.id !== nodeId);
                showStatus(`Nodo ${nodeId} enviado a cuarentena.`);
            }
        };

        // --- ASIGNACIÓN DE NODO A CUENTA DESDE POOL ---
        const openAccountSelectModal = (nodeId) => {
            nodeToAssign.value = nodeId;
            showAccountSelectModal.value = true;
            reinitIcons();
        };

        const confirmAssign = (uid) => {
            const acc = accounts.value.find(a => a.uid === uid);
            if(acc) {
                acc.nodeId = nodeToAssign.value;
                acc.ip = ''; 
                acc.isp = 'Desconocido';
                acc.county = 'Desconocido';
                acc.previousIp = null;
                showAccountSelectModal.value = false;
                showStatus(`Nodo asignado con éxito a ${acc.name}`);
                
                pool.value = pool.value.filter(n => n.id !== nodeToAssign.value);
            }
        };

        const togglePoolSort = (field) => {
            if (poolSort.value.field === field) poolSort.value.desc = !poolSort.value.desc;
            else { poolSort.value.field = field; poolSort.value.desc = false; }
            reinitIcons();
        };

        const filteredPool = computed(() => {
            let result = pool.value;

            // EL FILTRO EN TIEMPO REAL: LA LISTA NEGRA BORRA DE INMEDIATO DEL POOL
            result = result.filter(n => !blacklist.value.includes(n.id));

            // Refuerzo: oculta cualquier nodo viejo guardado en tu navegador de antes de
            // limitar las ISP (no hace falta borrar nada, esto ya lo filtra en la vista).
            result = result.filter(n => isIspPermitida(n.asn_isp));

            if (poolFilters.value.nodeId) {
                const s = poolFilters.value.nodeId.toLowerCase().trim();
                result = result.filter(n => n.id.toLowerCase().includes(s));
            }
            if (poolFilters.value.isp) {
                const s = poolFilters.value.isp.toLowerCase().trim();
                result = result.filter(n => (n.asn_isp || '').toLowerCase().includes(s));
            }
            if (poolFilters.value.city) {
                const s = poolFilters.value.city.toLowerCase().trim();
                result = result.filter(n => (n.city || '').toLowerCase().includes(s));
            }
            let minQAplicado = null;
            if (poolFilters.value.minQuality !== '' && poolFilters.value.minQuality !== null && poolFilters.value.minQuality !== undefined) {
                // Acepta "2.5" o "2,5" (el input es de texto, no number, para que no se coma el valor por el separador decimal del navegador)
                const minQ = parseFloat(String(poolFilters.value.minQuality).replace(',', '.'));
                if (!isNaN(minQ)) {
                    minQAplicado = minQ;
                    result = result.filter(n => parseFloat(n.q_score) >= minQ);
                }
            }

            if (poolSort.value.field) {
                result = [...result].sort((a, b) => {
                    let valA = a[poolSort.value.field] || '';
                    let valB = b[poolSort.value.field] || '';
                    if (poolSort.value.field === 'q_score') return poolSort.value.desc ? parseFloat(valA) - parseFloat(valB) : parseFloat(valB) - parseFloat(valA);
                    valA = valA.toLowerCase(); valB = valB.toLowerCase();
                    if (valA < valB) return poolSort.value.desc ? 1 : -1;
                    if (valA > valB) return poolSort.value.desc ? -1 : 1;
                    return 0;
                });
            } else if (minQAplicado !== null) {
                // Con un mínimo de calidad puesto, se muestra empezando desde ese mínimo
                // hacia arriba (2.1, 2.2, 2.3...), en vez del más alto primero.
                result = [...result].sort((a, b) => parseFloat(a.q_score) - parseFloat(b.q_score));
            } else {
                result = [...result].sort((a, b) => parseFloat(b.q_score) - parseFloat(a.q_score));
            }
            return result;
        });

        // --- DASHBOARD CHARTS ---
        const ispStats = computed(() => {
            const counts = {};
            const accountsWithIp = accounts.value.filter(a => a.ip && a.ip !== 'Pendiente').length || 1; 
            accounts.value.forEach(acc => {
                if (acc.isp && acc.isp !== 'Desconocido') {
                    let shortIsp = acc.isp.split(',')[0].substring(0, 18);
                    counts[shortIsp] = (counts[shortIsp] || 0) + 1;
                }
            });
            return Object.entries(counts)
                .map(([name, count]) => ({ name, count, percentage: Math.round((count / accountsWithIp) * 100) }))
                .sort((a, b) => b.count - a.count); 
        });

        const updateCharts = () => {
            nextTick(() => {
                const ctx = document.getElementById('ispChart');
                if (!ctx) return;
                const labels = ispStats.value.map(s => s.name);
                const data = ispStats.value.map(s => s.count);
                if (chartInstance) chartInstance.destroy();
                chartInstance = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: labels,
                        datasets: [{
                            data: data,
                            backgroundColor: ['rgba(79, 70, 229, 0.9)', 'rgba(16, 185, 129, 0.9)', 'rgba(244, 63, 94, 0.9)', 'rgba(245, 158, 11, 0.9)', 'rgba(14, 165, 233, 0.9)', 'rgba(168, 85, 247, 0.9)'],
                            borderColor: '#1e293b',
                            borderWidth: 3
                        }]
                    },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: '65%' }
                });
            });
        };

        const processBulkBlacklist = () => {
            if(!bulkBlacklistText.value.trim()) return;
            const rawItems = bulkBlacklistText.value.split(/[\n,\s]+/);
            rawItems.forEach(item => {
                const limpio = item.trim();
                if(limpio.length >= 10 && !blacklist.value.includes(limpio)) { 
                    const truncado = limpio.length > 15 ? limpio.substring(0, 14) : limpio;
                    blacklist.value.unshift(truncado);
                }
            });
            bulkBlacklistText.value = ''; 
            showStatus('Nodos enviados a Cuarentena.');
        };
        const removeBlacklistNode = (index) => { blacklist.value.splice(index, 1); };
        const copyToClipboard = async (text, type = 'Dato') => { try { await navigator.clipboard.writeText(text); showStatus(`¡${type} Copiado!`); } catch (err) {} };

        // --- RESPALDO MANUAL: TÚ TIENES EL CONTROL, NO DEPENDE DEL NAVEGADOR ---
        const downloadBackup = () => {
            const backup = {
                fecha: new Date().toISOString(),
                accounts: accounts.value,
                blacklist: blacklist.value,
                pool: pool.value
            };
            const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const fechaCorta = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
            a.href = url;
            a.download = `respaldo-aliens-${fechaCorta}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showStatus('¡Respaldo descargado!');
        };

        const restoreBackup = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const confirmed = confirm('Esto va a REEMPLAZAR tus cuentas, lista negra y pool actuales por los del archivo de respaldo. ¿Continuar?');
            if (!confirmed) { event.target.value = null; return; }

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (!data || typeof data !== 'object') throw new Error('Formato inválido');
                    accounts.value = Array.isArray(data.accounts) ? data.accounts : accounts.value;
                    blacklist.value = Array.isArray(data.blacklist) ? data.blacklist : blacklist.value;
                    pool.value = Array.isArray(data.pool) ? data.pool : pool.value;
                    reinitIcons();
                    updateCharts();
                    showStatus('¡Respaldo restaurado con éxito!');
                } catch (err) {
                    alert('🚫 Error al leer el archivo de respaldo. Verifica que sea el JSON correcto.');
                }
                event.target.value = null;
            };
            reader.readAsText(file);
        };
        const showStatus = (msg) => { syncStatus.value = msg; setTimeout(() => { syncStatus.value = ''; }, 3000); };
        const reinitIcons = () => { nextTick(() => { if(window.lucide) lucide.createIcons(); }); };
        
        onMounted(() => { 
            loadData(); 
            purgeNonAllowedIsps();
            reinitIcons(); 
            updateCharts();
        });

        watch(currentTab, () => {
            reinitIcons();
            if (currentTab.value === 'dashboard') updateCharts();
        });

        return {
            currentTab, isSidebarOpen, toggleSidebar, accounts, pool, blacklist, syncStatus, bulkBlacklistText, 
            collisionCount, hasCollision, addAccount, removeAccount, processBulkBlacklist, removeBlacklistNode,
            fetchMysteriumAPI, importPoolJSON, copyToClipboard, burnDirectlyFromPool, burnNodeFromAccount,
            filteredPool, poolFilters, poolSort, togglePoolSort,
            processedAccounts, accountSearch, accountSort, toggleAccountSort,
            showBulkLoadModal, bulkLoadText, processBulkLoad, fetchSingleISP, forceEnrichmentSweep,
            ispStats, autoDetectIP, manualIPCheck, undoIp,
            showAccountSelectModal, nodeToAssign, openAccountSelectModal, confirmAssign,
            downloadBackup, restoreBackup, isFetchingPool
        };
    }
}).mount('#app');
