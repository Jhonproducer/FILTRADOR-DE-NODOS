const { createApp, ref, computed, watch, onMounted, nextTick } = Vue;

const generateUid = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

// Definición de las TOP 5 UK ISPs (Filtro Anti-Basura)
const topUKISPs = ['bt', 'british telecom', 'sky', 'virgin', 'talktalk', 'vodafone', 'ee'];

createApp({
    setup() {
        const currentTab = ref('accounts');
        const syncStatus = ref('');
        const bulkBlacklistText = ref('');
        
        const showPoolModal = ref(false);
        const selectedAccountUid = ref(null);

        const showAccountSelectModal = ref(false);
        const nodeToAssign = ref(null);
        
        const accounts = ref([]);
        const pool = ref([]);
        const blacklist = ref([]);

        // RASTREADOR DE ISP PARA ANTI-FINGERPRINTING
        const lastWorkedIsp = ref(null);

        // NUEVO: FILTRO DE CALIDAD
        const filters = ref({ nodeId: '', city: '', isp: '', qScore: null });
        const sortDesc = ref(true); 
        const toggleSortScore = () => { sortDesc.value = !sortDesc.value; };
        const clearFilters = () => { filters.value.nodeId = ''; filters.value.city = ''; filters.value.isp = ''; filters.value.qScore = null; };

        const filteredPool = computed(() => {
            let result = pool.value;
            result = result.filter(n => {
                const inBlacklist = blacklist.value.some(b => b.nodeId === n.id);
                const inUse = accounts.value.some(a => (a.nodeId || '').trim() === n.id);
                return !inBlacklist && !inUse;
            });
            if (filters.value.nodeId) {
                const s = filters.value.nodeId.toLowerCase().trim();
                result = result.filter(n => n.id.toLowerCase().includes(s));
            }
            if (filters.value.city) {
                const c = filters.value.city.toLowerCase().trim();
                result = result.filter(n => (n.city || '').toLowerCase().includes(c));
            }
            if (filters.value.isp) {
                const i = filters.value.isp.toLowerCase().trim();
                result = result.filter(n => (n.asn_isp || '').toLowerCase().includes(i));
            }
            // NUEVA LÓGICA: FILTRO Q-SCORE
            if (filters.value.qScore) {
                result = result.filter(n => parseFloat(n.q_score) >= parseFloat(filters.value.qScore));
            }
            return result.sort((a, b) => sortDesc.value ? b.q_score - a.q_score : a.q_score - b.q_score);
        });

        const accountSearch = ref('');
        const accountSort = ref({ field: null, desc: false });

        const toggleAccountSort = (field) => {
            if (accountSort.value.field === field) {
                accountSort.value.desc = !accountSort.value.desc;
            } else {
                accountSort.value.field = field;
                accountSort.value.desc = false;
            }
        };

        const processedAccounts = computed(() => {
            let result = accounts.value;
            if (accountSearch.value) {
                const s = accountSearch.value.toLowerCase().trim();
                result = result.filter(a => 
                    a.name.toLowerCase().includes(s) || 
                    (a.nodeId || '').toLowerCase().includes(s) || 
                    (a.ip || '').toLowerCase().includes(s) ||
                    (a.asn_isp || '').toLowerCase().includes(s)
                );
            }
            if (accountSort.value.field) {
                result = [...result].sort((a, b) => {
                    let valA = a[accountSort.value.field] || '';
                    let valB = b[accountSort.value.field] || '';
                    if (accountSort.value.field === 'q_score') {
                        valA = parseFloat(valA) || 0;
                        valB = parseFloat(valB) || 0;
                    }
                    if (valA < valB) return accountSort.value.desc ? 1 : -1;
                    if (valA > valB) return accountSort.value.desc ? -1 : 1;
                    return 0;
                });
            }
            return result;
        });

        const saveData = () => {
            localStorage.setItem('vpnerp_acc_master_v13', JSON.stringify(accounts.value));
            localStorage.setItem('vpnerp_pool_master_v13', JSON.stringify(pool.value));
            localStorage.setItem('vpnerp_blk_master_v13', JSON.stringify(blacklist.value));
        };

        const loadData = () => {
            let savedAcc = JSON.parse(localStorage.getItem('vpnerp_acc_master_v13'));
            let savedPool = JSON.parse(localStorage.getItem('vpnerp_pool_master_v13'));
            let savedBlk = JSON.parse(localStorage.getItem('vpnerp_blk_master_v13'));

            if (!savedAcc || savedAcc.length === 0) {
                const oldKeys = ['v12', 'v11', 'master_v12', 'master_v11', 'master'];
                for (let v of oldKeys) {
                    let oldAcc = JSON.parse(localStorage.getItem(`vpnerp_acc_${v}`)) || JSON.parse(localStorage.getItem(`vpnerp_acc_master_${v}`));
                    if (oldAcc && oldAcc.length > 0) {
                        savedAcc = oldAcc;
                        savedPool = JSON.parse(localStorage.getItem(`vpnerp_pool_${v}`)) || JSON.parse(localStorage.getItem(`vpnerp_pool_master_${v}`));
                        savedBlk = JSON.parse(localStorage.getItem(`vpnerp_blk_${v}`)) || JSON.parse(localStorage.getItem(`vpnerp_blk_master_${v}`));
                        break;
                    }
                }
            }

            if (savedAcc && savedAcc.length > 0) {
                accounts.value = savedAcc.map(a => ({ 
                    ...a, 
                    uid: a.uid || generateUid(),
                    previousIp: a.previousIp || null,
                    scamalyticsScore: a.scamalyticsScore || null // Nueva variable para guardar el score scrapeado
                }));
            } else {
                const initial = [];
                for(let i = 1; i <= 28; i++) {
                    const num = i < 10 ? '0'+i : i;
                    initial.push({ uid: generateUid(), name: `LON-${num}`, nodeId: '', ip: '', q_score: '', asn_isp: '', previousIp: null, scamalyticsScore: null });
                }
                accounts.value = initial;
            }
            pool.value = savedPool || [];
            blacklist.value = savedBlk || [];
        };

        watch([accounts, pool, blacklist], saveData, { deep: true });

        // ==========================================
        // 🚀 CASCADA IP + REGISTRO DE ÚLTIMO ISP
        // ==========================================
        const registerIspWork = (acc) => {
            if(acc.asn_isp) {
                // Al tocar una fila, se anota cuál fue el proveedor para evadirlo después
                let baseIsp = acc.asn_isp.split('-')[1]?.trim() || acc.asn_isp;
                baseIsp = baseIsp.split(' ')[0].toLowerCase(); // Toma la primera palabra (ej "Virgin")
                lastWorkedIsp.value = baseIsp;
            }
        };

        const fetchCurrentIP = async (uid) => {
            const acc = accounts.value.find(a => a.uid === uid);
            if(!acc) return;
            registerIspWork(acc); // Registramos que estamos trabajando esta cuenta

            syncStatus.value = 'Detectando IP...';
            let newIp = null;

            try {
                const r1 = await fetch("https://api.ipify.org?format=json");
                if(r1.ok) { const d1 = await r1.json(); newIp = d1.ip; }
            } catch(e) {}

            if(!newIp) {
                try {
                    const r2 = await fetch("https://ipinfo.io/json", { headers: { 'Authorization': 'Bearer 8c97cc52a98a48' } });
                    if(r2.ok) { const d2 = await r2.json(); newIp = d2.ip; }
                } catch(e) {}
            }

            if(!newIp) {
                try {
                    const r3 = await fetch("https://api.myip.com");
                    if(r3.ok) { const d3 = await r3.json(); newIp = d3.ip; }
                } catch(e) {}
            }

            if(newIp) {
                if(acc.ip === newIp) { 
                    syncStatus.value = 'Misma IP.'; 
                    setTimeout(() => { syncStatus.value = ''; }, 3000);
                    return; 
                }

                const collides = accounts.value.some(a => a.uid !== uid && a.ip === newIp);
                if(collides) {
                    const proceed = confirm(`⚠️ ALERTA DE COLISIÓN\n\nLa IP detectada (${newIp}) YA ESTÁ en otra cuenta.\n¿Sobrescribir de todos modos?`);
                    if(!proceed) { syncStatus.value = 'Cancelado.'; setTimeout(() => { syncStatus.value = ''; }, 3000); return; }
                }

                acc.previousIp = acc.ip; 
                acc.ip = newIp;
                acc.scamalyticsScore = null; // Borramos el score viejo si la IP cambia
                triggerCollisionCheck(acc);
                syncStatus.value = '¡IP extraída!';
            } else {
                alert("Bloqueo de red total para extracción de IP.");
                syncStatus.value = '';
            }
            setTimeout(() => { syncStatus.value = ''; }, 3000);
        };

        const undoIp = (uid) => {
            const acc = accounts.value.find(a => a.uid === uid);
            if(acc && acc.previousIp) {
                acc.ip = acc.previousIp; 
                acc.previousIp = null; 
                acc.scamalyticsScore = null;
                triggerCollisionCheck(acc); 
                syncStatus.value = 'IP Restaurada.';
                setTimeout(() => { syncStatus.value = ''; }, 3000);
            }
        };

        // ==========================================
        // 🤖 WEB SCRAPING: SCAMALYTICS (CON PROXY)
        // ==========================================
        const autoScrapeScamalytics = async (acc) => {
            if(!acc.ip || acc.ip.trim() === '') {
                alert("Necesitas una IP primero."); return;
            }
            registerIspWork(acc);
            
            syncStatus.value = 'Raspando Scamalytics...';
            try {
                // El truco maestro: Pasamos por AllOrigins para descargar el HTML de la página web
                const targetUrl = encodeURIComponent(`https://scamalytics.com/ip/${acc.ip.trim()}`);
                const res = await fetch(`https://api.allorigins.win/get?url=${targetUrl}`);
                const data = await res.json();
                
                if(data && data.contents) {
                    const html = data.contents;
                    
                    // Verificamos si Cloudflare nos mandó a comer tierra
                    if(html.includes("cf-browser-verification") || html.includes("Just a moment...")) {
                        alert("🛡️ SCAMALYTICS ACTIVÓ DEFENSA (Cloudflare)\n\nEl robot ha sido bloqueado. Usa el botón 'Manual' para ver el Score.");
                        syncStatus.value = '';
                        return;
                    }

                    // REGEX: Buscamos la cadena "Fraud Score: [numero]" en el código HTML
                    const regex = /Fraud Score:\s*(\d+)/i;
                    const match = html.match(regex);
                    
                    if(match && match[1]) {
                        const score = parseInt(match[1]);
                        acc.scamalyticsScore = score;
                        
                        if(score > 15) {
                            alert(`🚨 RIESGO DE FRAUDE CRÍTICO 🚨\n\nLa IP ${acc.ip} devolvió un Score de: ${score}\n\nDeberías quemar este nodo inmediatamente.`);
                        } else {
                            syncStatus.value = `¡Score Perfecto: ${score}!`;
                        }
                    } else {
                        alert("No se pudo encontrar el número del Score en la web. Puede que hayan cambiado el diseño. Usa Manual.");
                    }
                }
            } catch(e) {
                alert("Error de red en el Proxy al intentar raspar.");
            }
            setTimeout(() => { syncStatus.value = ''; }, 4000);
        };

        const openScamalytics = (ip) => {
            if(!ip || ip.trim() === '') return;
            window.open(`https://scamalytics.com/ip/${ip.trim()}`, '_blank');
        };

        // ==========================================
        // 🔮 ANTI-FINGERPRINTING ROUTING (SIGUIENTE PERFIL SEGURO)
        // ==========================================
        const recommendNextSafeAccount = () => {
            // Buscamos cuentas que ESTÉN ACTIVAS (con nodo) y que NO TENGAN la misma empresa ISP que la última.
            const available = accounts.value.filter(a => {
                if(!a.nodeId || !a.asn_isp) return false;
                
                // Si no hay lastWorkedIsp, cualquiera sirve
                if(!lastWorkedIsp.value) return true;
                
                // Si la cuenta actual tiene la misma empresa que la última trabajada, la descartamos
                const currentIsp = a.asn_isp.toLowerCase();
                return !currentIsp.includes(lastWorkedIsp.value);
            });

            if(available.length === 0) {
                alert("No hay perfiles activos con proveedores diferentes al actual.\n\nNota: Asegúrate de tener cuentas con nodos asignados de diferentes ISP.");
                return;
            }

            // Seleccionamos uno aleatorio
            const randomAcc = available[Math.floor(Math.random() * available.length)];
            
            // Escribimos su nombre en el buscador para que sea el ÚNICO que aparezca en pantalla
            accountSearch.value = randomAcc.name;
            showStatus(`Sugerencia Segura: ${randomAcc.name} (Evitando: ${lastWorkedIsp.value})`);
        };


        const openPoolModal = (uid) => { selectedAccountUid.value = uid; clearFilters(); showPoolModal.value = true; };
        const closePoolModal = () => { showPoolModal.value = false; selectedAccountUid.value = null; };
        const openAccountSelectModal = (node) => { nodeToAssign.value = node; showAccountSelectModal.value = true; };
        const closeAccountSelectModal = () => { showAccountSelectModal.value = false; nodeToAssign.value = null; };
        
        const triggerCollisionCheck = (currentAccount) => {
            if(hasCollision(currentAccount)) {
                alert(`¡ALERTA CRÍTICA!\n\nEl Nodo o IP ingresado YA EXISTE en otra cuenta activa.`);
            }
        };

        const hasCollision = (currentAccount) => {
            if (!currentAccount.ip && !currentAccount.nodeId) return false;
            return accounts.value.some(acc => {
                if (acc.uid === currentAccount.uid) return false;
                const curIp = (currentAccount.ip || '').trim();
                const accIp = (acc.ip || '').trim();
                const curNode = (currentAccount.nodeId || '').trim();
                const accNode = (acc.nodeId || '').trim();
                return (accIp !== '' && curIp !== '' && accIp === curIp) || 
                       (accNode !== '' && curNode !== '' && accNode === curNode);
            });
        };

        const collisionCount = computed(() => accounts.value.filter(acc => hasCollision(acc)).length);

        const assignNodeToAccount = (nodeId) => {
            if (selectedAccountUid.value) {
                const acc = accounts.value.find(a => a.uid === selectedAccountUid.value);
                if (acc) {
                    const nodeData = pool.value.find(n => n.id === nodeId);
                    acc.nodeId = nodeId; acc.ip = ''; acc.previousIp = null; acc.scamalyticsScore = null;
                    if(nodeData) { acc.q_score = nodeData.q_score; acc.asn_isp = nodeData.asn_isp; }
                    closePoolModal(); triggerCollisionCheck(acc);
                }
            }
        };

        const confirmAssignFromPool = (accountUid) => {
            const acc = accounts.value.find(a => a.uid === accountUid);
            if (acc && nodeToAssign.value) {
                acc.nodeId = nodeToAssign.value.id;
                acc.ip = ''; acc.previousIp = null; acc.scamalyticsScore = null;
                acc.q_score = nodeToAssign.value.q_score;
                acc.asn_isp = nodeToAssign.value.asn_isp;
                closeAccountSelectModal(); triggerCollisionCheck(acc); 
            }
        };

        const burnDirectlyFromPool = (node) => {
            if(node && node.id) {
                if(!blacklist.value.some(b => b.nodeId === node.id)) {
                    blacklist.value.unshift({ nodeId: node.id, ip: 'Quemado desde Pool' });
                }
            }
        };

        const addAccount = () => {
            const num = accounts.value.length + 1;
            accounts.value.push({ uid: generateUid(), name: `LON-${num < 10 ? '0'+num : num}`, nodeId: '', ip: '', q_score: '', asn_isp: '', previousIp: null, scamalyticsScore: null });
        };
        const removeAccount = (uid) => { if(confirm("¿Eliminar cuenta?")) accounts.value = accounts.value.filter(a => a.uid !== uid); };
        const releaseNode = (uid) => { const acc = accounts.value.find(a => a.uid === uid); if(acc) { acc.nodeId = ''; acc.ip = ''; acc.q_score = ''; acc.asn_isp = ''; acc.previousIp = null; acc.scamalyticsScore = null; } };
        
        const burnNode = (uid) => {
            const acc = accounts.value.find(a => a.uid === uid);
            if(acc) {
                const nodeStr = (acc.nodeId || '').trim();
                if(nodeStr) {
                    const truncado = nodeStr.substring(0, 14); 
                    if(!blacklist.value.some(b => b.nodeId === truncado)) {
                        blacklist.value.unshift({ nodeId: truncado, ip: acc.ip || 'Desconocida' });
                    }
                }
                acc.nodeId = ''; acc.ip = ''; acc.q_score = ''; acc.asn_isp = ''; acc.previousIp = null; acc.scamalyticsScore = null;
            }
        };

        const processBulkBlacklist = () => {
            if(!bulkBlacklistText.value.trim()) return;
            const rawItems = bulkBlacklistText.value.split(/[\n,\s]+/);
            rawItems.forEach(item => {
                const limpio = item.trim();
                if(limpio.length >= 10) { 
                    const truncado = limpio.substring(0, 14); 
                    if(!blacklist.value.some(b => b.nodeId === truncado)) {
                        blacklist.value.unshift({ nodeId: truncado, ip: 'Carga Masiva' });
                    }
                }
            });
            bulkBlacklistText.value = ''; 
        };
        const removeBlacklistNode = (index) => { blacklist.value.splice(index, 1); };

        // ==========================================
        // 🧹 MOTOR DE LIMPIEZA DE BASURA (TOP 5 UK ISPs)
        // ==========================================
        const processNodeData = (data) => {
            const rawPool = [];
            const seenIds = new Set(); 
            
            data.forEach(nodo => {
                if (nodo.service_type !== "wireguard" || !nodo.provider_id) return;
                const idCorto = nodo.provider_id.substring(0, 14);
                if(seenIds.has(idCorto)) return;
                
                // FILTRO VIP: Solo dejamos pasar a los gigantes del Reino Unido.
                const ispName = (nodo.location?.isp || '').toLowerCase();
                const isTopIsp = topUKISPs.some(top => ispName.includes(top));
                
                if(!isTopIsp) return; // Si es una empresa basura/rara, se descarta.

                const isBlacklisted = blacklist.value.some(b => b.nodeId === idCorto);
                const isUsed = accounts.value.some(a => (a.nodeId || '').trim() === idCorto);
                
                if (!isBlacklisted && !isUsed) {
                    seenIds.add(idCorto);
                    rawPool.push({
                        id: idCorto,
                        city: nodo.location?.city || 'N/A',
                        asn_isp: `${nodo.location?.asn || ''} - ${nodo.location?.isp || 'N/A'}`,
                        q_score: (nodo.quality?.quality || 0).toFixed(2)
                    });
                }
            });
            pool.value = rawPool.sort((a, b) => b.q_score - a.q_score);
            showStatus(`API Filtrada: Solo Top ISPs UK.`);
        };

        const fetchAPI = async () => {
            syncStatus.value = 'Conectando Mysterium...';
            try {
                const url = "https://discovery.mysterium.network/api/v3/proposals?location_country=GB&ip_type=residential";
                const response = await fetch(url, { headers: { 'accept': 'application/json' } });
                if(!response.ok) throw new Error("Error API Original");
                const data = await response.json();
                processNodeData(data);
            } catch (err) {
                console.error("Fallo nativo, intentando respaldo...");
                try {
                    const url = "https://discovery.mysterium.network/api/v3/proposals?location_country=GB&ip_type=residential";
                    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
                    const response = await fetch(proxyUrl);
                    const data = await response.json();
                    processNodeData(data);
                } catch(e) {
                    alert("Mysterium está bloqueado en tu red. Sube el JSON.");
                    syncStatus.value = '';
                }
            }
        };

        const importPoolJSON = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    processNodeData(data); 
                    event.target.value = null; 
                } catch (err) { alert("Error JSON."); event.target.value = null; }
            };
            reader.readAsText(file);
        };

        // ==========================================
        // 📥 IMPORTACIÓN DE BACKUP (RESTAURAR)
        // ==========================================
        const importDatabase = (event) => {
            const file = event.target.files[0];
            if(!file) return;
            
            if(!confirm("⚠️ ADVERTENCIA\n\nEstás a punto de sobreescribir TODOS los datos actuales con el archivo de respaldo.\n\n¿Deseas continuar?")) {
                event.target.value = null;
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if(data.accounts && data.pool && data.blacklist) {
                        accounts.value = data.accounts;
                        pool.value = data.pool;
                        blacklist.value = data.blacklist;
                        saveData(); // Forzamos el guardado
                        alert("¡Base de Datos Restaurada con Éxito!");
                    } else {
                        alert("El archivo no tiene el formato de Base de Datos del VPN ERP.");
                    }
                    event.target.value = null; 
                } catch (err) { alert("Error leyendo el archivo JSON."); event.target.value = null; }
            };
            reader.readAsText(file);
        };

        const copyToClipboard = async (text, type = 'Dato') => {
            try { 
                await navigator.clipboard.writeText(text); 
                showStatus(`¡${type} Copiado!`); 
                setTimeout(() => { syncStatus.value = ''; }, 3000);
                
                // Si el usuario copió un nodo de una cuenta, registramos el ISP para el sistema Anti-Patrón
                const acc = accounts.value.find(a => a.nodeId === text);
                if(acc) registerIspWork(acc);
                
            } catch (err) { console.error(err); }
        };

        const exportDatabase = () => {
            const dataStr = JSON.stringify({ accounts: accounts.value, pool: pool.value, blacklist: blacklist.value }, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `VPN_ERP_Respaldo_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
        };

        const showStatus = (msg) => { syncStatus.value = msg; setTimeout(() => { syncStatus.value = ''; }, 3000); };
        
        onMounted(() => { loadData(); });

        return {
            currentTab, accounts, pool, blacklist, syncStatus, bulkBlacklistText, 
            showPoolModal, selectedAccountUid, showAccountSelectModal, nodeToAssign,
            collisionCount, accountSearch, accountSort, processedAccounts, toggleAccountSort, 
            filters, filteredPool, toggleSortScore, clearFilters, hasCollision, triggerCollisionCheck, 
            addAccount, removeAccount, releaseNode, burnNode, processBulkBlacklist, removeBlacklistNode, 
            importPoolJSON, fetchAPI, copyToClipboard, exportDatabase, importDatabase,
            openPoolModal, closePoolModal, assignNodeToAccount,
            openAccountSelectModal, closeAccountSelectModal, confirmAssignFromPool, burnDirectlyFromPool,
            fetchCurrentIP, undoIp, openScamalytics, autoScrapeScamalytics,
            lastWorkedIsp, recommendNextSafeAccount, registerIspWork
        };
    },
    updated() { if(window.lucide) { lucide.createIcons(); } }
}).mount('#app');
